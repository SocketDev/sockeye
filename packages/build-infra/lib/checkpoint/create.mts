import { promises as fs, renameSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { isErrnoException } from '@socketsecurity/lib-stable/errors/predicates'
import { safeDeleteSync, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { PLATFORM_AGNOSTIC_CHECKPOINTS } from '../constants.mts'
import { errorMessage } from '../error-utils.mts'
import { adHocSign } from '../sign.mts'
import {
  getCheckpointArtifactPath,
  getCheckpointDirectory,
  getCheckpointFile,
  getCheckpointTempFilePath,
} from './paths.mts'
import { createCheckpointArchive } from './archive.mts'
import { computeCreationCacheHash } from './creation-cache.mts'
import { cleanupPreviousCheckpoint } from './cleanup.mts'

const logger = getDefaultLogger()

export interface CheckpointCreationOptions {
  arch?: string | undefined
  artifactPath?: string | undefined
  binaryPath?: string | undefined
  buildMode?: string | undefined
  checkpointChain?: string[] | undefined
  configureFlags?: string | undefined
  libc?: string | undefined
  nodeVersion?: string | undefined
  packageName?: string | undefined
  packageRoot?: string | undefined
  platform?: string | undefined
  sourcePaths?: string[] | undefined
  tarExcludes?: string[] | undefined
  withLief?: boolean | undefined
  [key: string]: unknown
}

export async function createCheckpoint(
  buildDir: string,
  checkpointName: string,
  smokeTest: () => Promise<void>,
  options: CheckpointCreationOptions = {},
): Promise<void> {
  const {
    arch,
    artifactPath,
    binaryPath,
    buildMode,
    checkpointChain,
    configureFlags,
    libc,
    nodeVersion,
    packageName = '',
    packageRoot,
    platform,
    sourcePaths,
    tarExcludes,
    withLief,
    ...rest
  } = options

  validateCheckpointCreation(checkpointName, smokeTest, { platform, arch })

  const data = {
    arch,
    artifactPath,
    binaryPath,
    buildMode,
    configureFlags,
    libc,
    nodeVersion,
    packageRoot,
    platform,
    sourcePaths,
    withLief,
    ...rest,
  }

  if (data.binaryPath) {
    const resolvedBinaryPath = getCheckpointArtifactPath(
      buildDir,
      data.binaryPath,
    )

    await adHocSign(resolvedBinaryPath)
  }

  const checkpointId = describeCheckpointTarget(checkpointName, {
    platform,
    arch,
    libc,
  })

  if (packageRoot) {
    const relativeRoot = path.relative(process.cwd(), packageRoot) || '.'
    logger.log('')
    logger.substep(`Working in: ${relativeRoot}`)
  }

  logger.substep(`Testing ${checkpointId}`)
  try {
    await smokeTest()
  } catch (e) {
    throw new Error(
      `Smoke test failed for checkpoint '${checkpointName}': ${errorMessage(e)}`,
      { cause: e },
    )
  }

  logger.substep(`Creating ${checkpointId} checkpoint`)

  const checkpointDir = getCheckpointDirectory(buildDir, packageName)
  await safeMkdir(checkpointDir)

  const checkpointFile = getCheckpointFile(checkpointDir, checkpointName)

  const { checkpointAlreadyExists, artifactHash } = data.artifactPath
    ? await createCheckpointArchive(buildDir, checkpointName, checkpointFile, {
        artifactPath: data.artifactPath,
        packageRoot,
        tarExcludes,
      })
    : { checkpointAlreadyExists: false, artifactHash: undefined }

  const cacheHash = computeCreationCacheHash(checkpointName, data)

  logger.log('')

  if (!checkpointAlreadyExists) {
    const checkpointData = {
      created: new Date().toISOString(),
      name: checkpointName,
      ...data,
      cacheHash,
      artifactHash,
    }

    const tempCheckpointFile = getCheckpointTempFilePath(checkpointFile)
    await fs.writeFile(
      tempCheckpointFile,
      JSON.stringify(checkpointData, null, 2),
      'utf8',
    )
    try {
      renameSync(tempCheckpointFile, checkpointFile)
    } catch (e) {
      if (isErrnoException(e) && (e.code === 'EEXIST' || e.code === 'EPERM')) {
        logger.warn(
          `Checkpoint JSON already exists: ${checkpointFile}. Concurrent build detected.`,
        )
        safeDeleteSync(tempCheckpointFile)
      } else {
        throw e
      }
    }
  }

  await cleanupPreviousCheckpoint(checkpointDir, checkpointName, {
    checkpointChain,
    artifactPath: data.artifactPath,
  })
}

export function describeCheckpointTarget(
  checkpointName: string,
  config: {
    platform: string | undefined
    arch: string | undefined
    libc: string | undefined
  },
): string {
  const { platform, arch, libc } = {
    __proto__: null,
    ...config,
  } as typeof config
  let checkpointId = checkpointName
  if (platform && arch) {
    const libcSuffix = libc ? `-${libc}` : ''
    checkpointId = `${checkpointName} (${platform}-${arch}${libcSuffix})`
  } else if (platform) {
    checkpointId = `${checkpointName} (${platform})`
  }

  return checkpointId
}

export function validateCheckpointCreation(
  checkpointName: string,
  smokeTest: () => Promise<void>,
  config: { platform: string | undefined; arch: string | undefined },
): void {
  const { platform, arch } = { __proto__: null, ...config } as typeof config
  if (!PLATFORM_AGNOSTIC_CHECKPOINTS.has(checkpointName)) {
    if (!platform || !arch) {
      throw new Error(
        `createCheckpoint('${checkpointName}') requires explicit target {platform, arch} for binary stages. ` +
          `Got platform=${platform ?? 'undefined'}, arch=${arch ?? 'undefined'}. ` +
          'Pass getCurrentPlatformArch() results or matrix.platform / matrix.arch explicitly — ' +
          'the host-platform fallback was removed because it silently mis-tagged cache entries under cross-compilation.',
      )
    }
  }

  if (typeof smokeTest !== 'function') {
    const actualValue =
      typeof smokeTest === 'object'
        ? `object with keys: ${Object.keys(smokeTest).join(', ')}`
        : typeof smokeTest
    throw new Error(
      `\n${'='.repeat(70)}\n` +
        'ERROR: createCheckpoint() called incorrectly!\n' +
        `${'='.repeat(70)}\n` +
        `Checkpoint: "${checkpointName}"\n` +
        '\n' +
        'Expected parameter 3: smokeTest callback function\n' +
        `Actual parameter 3: ${actualValue}\n` +
        '\n' +
        'Correct pattern:\n' +
        '  createCheckpoint(buildDir, checkpointName, async () => {\n' +
        '    // Smoke test validation code here\n' +
        '  }, options)\n' +
        '\n' +
        'You passed:\n' +
        '  createCheckpoint(buildDir, checkpointName, options) Missing callback!\n' +
        `${'='.repeat(70)}\n`,
    )
  }
}
