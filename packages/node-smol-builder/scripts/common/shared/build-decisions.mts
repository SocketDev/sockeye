import { existsSync } from 'node:fs'
import { CHECKPOINTS } from 'local-build-infra/lib/constants'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getReleaseCheckpointPaths } from './paths.mts'

const logger = getDefaultLogger()

export function getBuildResumePlan(fromCheckpoint: string | undefined) {
  return {
    __proto__: null,
    skipReleasePhase: [
      CHECKPOINTS.BINARY_RELEASED,
      CHECKPOINTS.BINARY_STRIPPED,
      CHECKPOINTS.BINARY_COMPRESSED,
      CHECKPOINTS.FINALIZED,
    ].includes(fromCheckpoint ?? ''),
    skipToCompressed:
      fromCheckpoint === CHECKPOINTS.BINARY_COMPRESSED ||
      fromCheckpoint === CHECKPOINTS.FINALIZED,
    skipToFinalized: fromCheckpoint === CHECKPOINTS.FINALIZED,
  }
}

export function reportBuildStop(
  checkpoint: string,
  config: {
    binaryLabel: string
    binaryPath: string
    buildOnly: string | undefined
    stopAt: string | undefined
  },
): boolean {
  const { binaryLabel, binaryPath, buildOnly, stopAt } = config
  if (stopAt !== checkpoint && buildOnly !== checkpoint) {
    return false
  }
  logger.log('')
  if (buildOnly) {
    logger.skip(
      `Build completed at ${checkpoint} (--build-only=${checkpoint}, checkpoint skipped)`,
    )
  } else {
    logger.success(`Build stopped at ${checkpoint} (--stop-at=${checkpoint})`)
  }
  logger.log(`${binaryLabel} binary: ${binaryPath}`)
  logger.log('')
  return true
}

export function validateBuildResume(
  fromCheckpoint: string,
  config: { buildDir: string; outputReleaseBinary: string },
): void {
  const { buildDir, outputReleaseBinary } = config
  if (fromCheckpoint === CHECKPOINTS.BINARY_RELEASED) {
    if (!existsSync(outputReleaseBinary)) {
      throw new Error(
        `Cannot skip to ${fromCheckpoint}: Release binary not found at ${outputReleaseBinary}`,
      )
    }
  } else {
    const checkpointFile = getReleaseCheckpointPaths(
      buildDir,
      fromCheckpoint,
    ).metadata
    if (!existsSync(checkpointFile)) {
      throw new Error(
        `Cannot skip to ${fromCheckpoint}: checkpoint not found at ${checkpointFile}`,
      )
    }
  }
}
