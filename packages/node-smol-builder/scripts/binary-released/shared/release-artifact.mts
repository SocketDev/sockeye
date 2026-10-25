import { promises as fs } from 'node:fs'
import {
  createCheckpoint,
  getFileSize,
  smokeTestBinary,
} from 'local-build-infra/lib/build-operations'
import { printError } from 'local-build-infra/lib/build-output'
import { CHECKPOINTS, nodeVersionRaw } from 'local-build-infra/lib/constants'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getReleaseOutputEntryPath, getReleaseOutputPaths } from './paths.mts'

const logger = getDefaultLogger()

export async function finalizeReleaseBinary(config) {
  const {
    arch,
    buildDir,
    buildSourcePaths,
    configureFlags,
    isCrossCompiling,
    isProdBuild,
    libc,
    nodeBinary,
    outputReleaseBinary,
    packageName,
    packageRoot,
    platform,
    skipCheckpoint,
    withLief,
  } = config
  // Test binary.
  // Will automatically fall back to static verification if cross-compiled.
  logger.step('Testing Binary (Release)')

  logger.log('Running comprehensive functionality tests…')
  logger.log('')

  const smokeTestPassed = await smokeTestBinary(
    nodeBinary,
    isCrossCompiling ? { arch } : {},
  )

  if (!smokeTestPassed) {
    printError(
      'Binary Failed Smoke Tests',
      'Binary failed comprehensive smoke tests after build',
      [
        'Build may have produced corrupted binary',
        'Try rebuilding: pnpm build --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Binary failed smoke tests')
  }

  logger.log('')
  logger.success('Binary is functional')
  logger.log('')

  // Copy to Release output.
  logger.step('Copying to Build Output (Release)')
  logger.log('Copying unmodified binary to Release directory…')
  logger.logNewline()

  const { directory: outputReleaseNodeDir, basename: releaseBinaryName } =
    getReleaseOutputPaths(outputReleaseBinary)
  await safeMkdir(outputReleaseNodeDir, { recursive: true })
  await fs.cp(nodeBinary, outputReleaseBinary, {
    force: true,
    preserveTimestamps: true,
  })

  logger.substep(`Release directory: ${outputReleaseNodeDir}`)
  logger.substep('Binary: node (unmodified)')
  logger.logNewline()
  logger.success(`Unmodified binary copied to ${outputReleaseNodeDir}`)
  logger.logNewline()

  // Clean Release directory before checkpoint to ensure only the release binary is archived
  // This removes any leftover files from previous builds
  if (!skipCheckpoint) {
    logger.substep('Cleaning checkpoint directory…')
    const releaseDirFiles = await fs.readdir(outputReleaseNodeDir)
    for (let i = 0, { length } = releaseDirFiles; i < length; i += 1) {
      const file = releaseDirFiles[i]
      if (file !== releaseBinaryName) {
        const filePath = getReleaseOutputEntryPath(outputReleaseNodeDir, file)
        await safeDelete(filePath)
        logger.substep(`Removed: ${file}`)
      }
    }
    logger.logNewline()

    // Create Release checkpoint.
    const releaseBinarySize = await getFileSize(outputReleaseBinary)
    await createCheckpoint(
      buildDir,
      CHECKPOINTS.BINARY_RELEASED,
      async () => {
        // Use smokeTestBinary with automatic fallback for cross-compiled builds
        const validated = await smokeTestBinary(
          outputReleaseBinary,
          isCrossCompiling ? { arch } : {},
        )
        if (!validated) {
          throw new Error('Binary validation failed')
        }
        logger.substep('Binary validated')
      },
      {
        arch,
        artifactPath: outputReleaseNodeDir,
        binarySize: releaseBinarySize,
        buildMode: isProdBuild ? 'prod' : 'dev',
        configureFlags: configureFlags.toSorted().join(','),
        libc,
        nodeVersion: nodeVersionRaw,
        packageName,
        packageRoot,
        platform,
        sourcePaths: buildSourcePaths,
        withLief,
      },
    )
    logger.log('')
  }

  return {
    __proto__: null,
    buildSourcePaths,
    isCrossCompiling,
    releaseBinaryPath: outputReleaseBinary,
  }
}
