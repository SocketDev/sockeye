import crypto from 'node:crypto'
import {
  closeSync,
  existsSync,
  openSync,
  promises as fs,
  readSync,
  renameSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  isDarwin,
  isWin32,
} from '@socketsecurity/lib-stable/constants/platform'
import { isErrnoException } from '@socketsecurity/lib-stable/errors/predicates'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { toUnixPath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'
import { withLock } from '../checkpoint-lock.mts'
import { computeSourceHash } from '../extraction-cache.mts'
import { extractTarball } from '../tarball-utils.mts'
import { whichRequired } from '../which-required.mts'
import {
  getCheckpointArtifactPath,
  getCheckpointExtractionTarget,
  getCheckpointLockPath,
  getCheckpointTarballPath,
  getCheckpointTempExtractionDir,
  getCheckpointTempTarballPath,
} from './paths.mts'

const WIN32 = isWin32()
const DARWIN = isDarwin()
const logger = getDefaultLogger()
export async function createCheckpointArchive(
  buildDir: string,
  checkpointName: string,
  checkpointFile: string,
  config: {
    artifactPath: string
    packageRoot: string | undefined
    tarExcludes: string[] | undefined
  },
): Promise<{
  checkpointAlreadyExists: boolean
  artifactHash: string | undefined
}> {
  const { artifactPath, packageRoot, tarExcludes } = {
    __proto__: null,
    ...config,
  } as typeof config
  let checkpointAlreadyExists = false

  let artifactHash: string | undefined

  const resolvedArtifactPath = getCheckpointArtifactPath(buildDir, artifactPath)

  const tarballPath = getCheckpointTarballPath(checkpointFile)

  const tarBin = await whichRequired('tar')
  const tarDir = path.dirname(resolvedArtifactPath)
  const tarBase = path.basename(resolvedArtifactPath)

  // oxlint-disable-next-line socket/prefer-exists-sync -- see above
  const stats = await fs.stat(resolvedArtifactPath)
  const isDir = stats.isDirectory()

  const displayPath = packageRoot
    ? path.relative(packageRoot, resolvedArtifactPath)
    : tarBase
  logger.substep(`Archiving ${displayPath}${isDir ? ' (dir)' : ''}`)

  const randomId = crypto.randomBytes(8).toString('hex')
  const tempTarballPath = getCheckpointTempTarballPath(tarballPath, randomId)
  const unixTempTarballPath = WIN32
    ? toUnixPath(tempTarballPath)
    : tempTarballPath
  const unixTarDir = WIN32 ? toUnixPath(tarDir) : tarDir

  const extraExcludes = Array.isArray(tarExcludes) ? tarExcludes : []
  const tarArgs = [
    '-czf',
    unixTempTarballPath,
    '--exclude=._*',
    ...extraExcludes.map(p => `--exclude=${p}`),
    '-C',
    unixTarDir,
    tarBase,
  ]

  try {
    if (isDir) {
      await validateCheckpointDirectory(resolvedArtifactPath)
    }

    await runCheckpointTar(tarBin, tarArgs)

    await validateCreatedCheckpointArchive(tempTarballPath, tarBin, {
      resolvedArtifactPath,
      tarBase,
    })

    await withLock(getCheckpointLockPath(tarballPath), 'ex', async () => {
      try {
        renameSync(tempTarballPath, tarballPath)
      } catch (e) {
        const renameErrorCode = isErrnoException(e) ? e.code : undefined
        if (renameErrorCode === 'EEXIST' || renameErrorCode === 'EPERM') {
          try {
            // oxlint-disable-next-line socket/prefer-exists-sync -- size required
            const existingStats = await fs.stat(tarballPath)
            if (existingStats.size > 0) {
              logger.warn(
                `Checkpoint already exists: ${tarballPath}. Concurrent build detected, skipping overwrite.`,
              )
              safeDeleteSync(tempTarballPath)
              checkpointAlreadyExists = true
            } else {
              await new Promise(resolve => setTimeout(resolve, 100))
              renameSync(tempTarballPath, tarballPath)
            }
          } catch {
            safeDeleteSync(tempTarballPath)
            checkpointAlreadyExists = true
          }
        } else if (renameErrorCode === 'ENOENT') {
          throw new Error(
            `Temp tarball was deleted before rename (TOCTOU race): ${tempTarballPath}. ` +
              'This can happen with concurrent builds. Checkpoint needs to be recreated.',
            { cause: e },
          )
        } else {
          throw e
        }
      }
    })
  } catch (e) {
    if (existsSync(tempTarballPath)) {
      safeDeleteSync(tempTarballPath)
    }
    const workingDirExists = existsSync(tarDir)
    const sourceExists = existsSync(resolvedArtifactPath)

    const tarballDir = path.dirname(tarballPath)
    const errorMsg = [
      `Failed to create checkpoint tarball: ${checkpointName}.tar.gz`,
      '',
      'Common causes:',
      `  - Source artifact exists: ${sourceExists ? 'yes' : 'no'}`,
      `  - Working directory exists: ${workingDirExists ? 'yes' : 'no'}`,
      '  - Insufficient disk space',
      '  - Permission denied writing tarball',
      '  - Invalid tar command or arguments',
      '',
      'Troubleshooting:',
      `  1. Source: ${resolvedArtifactPath}`,
      `  2. Tarball: ${tarballPath}`,
      `  3. Check disk space: df -h ${tarballDir}`,
      `  4. Check permissions: ls -ld ${tarballDir}`,
      `  5. Tar command: ${tarBin} ${tarArgs.join(' ')}`,
    ].join('\n')

    const err = new Error(errorMsg)
    err.cause = e
    throw err
  }

  // oxlint-disable-next-line socket/prefer-exists-sync -- see above
  const tarStats = await fs.stat(tarballPath)
  const sizeMB = (tarStats.size / 1024 / 1024).toFixed(1)
  logger.substep(`Saved ${checkpointName}.tar.gz (${sizeMB}MB)`)

  if (!checkpointAlreadyExists) {
    const tempExtractDir = getCheckpointTempExtractionDir(tarballPath)
    try {
      await extractTarball(tarballPath, tempExtractDir)

      const extractedArtifactPath = getCheckpointExtractionTarget(
        tarBase,
        tempExtractDir,
      )
      artifactHash = computeSourceHash([extractedArtifactPath], undefined, {
        relativeTo: tempExtractDir,
      })
      logger.substep(`Artifact hash: ${artifactHash.substring(0, 12)}...`)
    } finally {
      if (existsSync(tempExtractDir)) {
        safeDeleteSync(tempExtractDir, { recursive: true })
      }
    }
  }

  return { checkpointAlreadyExists, artifactHash }
}

export async function runCheckpointTar(
  tarBin: string,
  tarArgs: string[],
): Promise<void> {
  try {
    await spawn(tarBin, tarArgs, {
      env: DARWIN ? { ...process.env, COPYFILE_DISABLE: '1' } : process.env,
      stdio: 'pipe',
    })
  } catch (tarError) {
    const stderr = isSpawnError(tarError)
      ? (tarError.stderr?.toString().trim() ?? '')
      : ''
    const isFileChangedWarning =
      isSpawnError(tarError) &&
      tarError.code === 1 &&
      stderr.includes('file changed as we read it')

    if (isFileChangedWarning) {
      logger.warn(
        'tar: file changed during archiving (non-fatal, archive created)',
      )
    } else {
      throw tarError
    }
  }
}

export async function validateCheckpointDirectory(
  resolvedArtifactPath: string,
): Promise<void> {
  try {
    const contents = await fs.readdir(resolvedArtifactPath)
    if (contents.length === 0) {
      throw new Error(
        `Cannot archive empty directory: ${resolvedArtifactPath}. ` +
          'The artifact directory exists but contains no files.',
      )
    }
    logger.substep(`Directory contains ${contents.length} entries`)
  } catch (e) {
    if (isErrnoException(e) && (e.code === 'EACCES' || e.code === 'EPERM')) {
      throw new Error(
        `Cannot read directory: ${resolvedArtifactPath} (${e.code}). ` +
          'Check directory permissions.',
      )
    }
    throw e
  }
}

export async function validateCreatedCheckpointArchive(
  tempTarballPath: string,
  tarBin: string,
  config: { resolvedArtifactPath: string; tarBase: string },
): Promise<void> {
  const { resolvedArtifactPath, tarBase } = {
    __proto__: null,
    ...config,
  } as typeof config
  // oxlint-disable-next-line socket/prefer-exists-sync -- see above
  const tempStats = await fs.stat(tempTarballPath)
  if (tempStats.size === 0) {
    safeDeleteSync(tempTarballPath)
    throw new Error(
      `Tar created empty file (0 bytes). Artifact may not exist or tar command failed: ${resolvedArtifactPath}`,
    )
  }

  const MAX_CHECKPOINT_SIZE = 2 * 1024 * 1024 * 1024
  if (tempStats.size > MAX_CHECKPOINT_SIZE) {
    safeDeleteSync(tempTarballPath)
    throw new Error(
      `Checkpoint tarball exceeds maximum size: ${(tempStats.size / 1024 / 1024).toFixed(1)}MB > 2048MB. ` +
        `This may indicate unintended files were included in checkpoint: ${resolvedArtifactPath}`,
    )
  }

  const fd = openSync(tempTarballPath, 'r')
  try {
    const buffer = Buffer.alloc(2)
    readSync(fd, buffer, 0, 2, 0)
    if (buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
      throw new Error(
        `Tar created invalid gzip file (missing magic bytes 0x1f 0x8b): ${tempTarballPath}`,
      )
    }
  } finally {
    closeSync(fd)
  }

  const listResult = await spawn(
    tarBin,
    ['-tzf', WIN32 ? toUnixPath(tempTarballPath) : tempTarballPath],
    {
      stdio: 'pipe',
    },
  )
  if (listResult.code !== 0) {
    throw new Error(
      'Tarball validation failed - archive appears corrupted or truncated',
    )
  }
  const tarContents = listResult.stdout ?? ''
  if (!tarContents || !tarContents.includes(tarBase)) {
    throw new Error(`Tarball missing expected file: ${tarBase}`)
  }
}
