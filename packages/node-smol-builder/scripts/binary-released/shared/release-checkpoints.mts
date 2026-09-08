import path from 'node:path'
import {
  computeBuildInputsFingerprint,
  formatStaleCheckpointMessage,
  isCheckpointFingerprintCurrent,
} from 'local-build-infra/lib/checkpoint-cache-key'
import {
  getCheckpointData,
  hasCheckpoint,
} from 'local-build-infra/lib/checkpoint-manager'
import { CHECKPOINTS, nodeVersionRaw } from 'local-build-infra/lib/constants'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

export async function inspectReleaseCheckpoints(config: {
  buildDir: string
  checkpointChain: readonly string[]
  packageName: string
  packageRoot: string
}): Promise<boolean> {
  const { buildDir, checkpointChain, packageName, packageRoot } = config
  // Progressive checkpoint restoration (same as CI restore-checkpoint action).
  // Walk backward through checkpoint chain to find latest valid checkpoint.
  // This allows local builds to resume from the same point as CI builds.
  let resumeFromCheckpoint

  // Build-inputs fingerprint: sha256 over additions/, patches/, and the
  // target Node.js version. Gates the FINALIZED short-circuit below so a
  // checkpoint saved against different inputs is refused instead of
  // silently standing in for a fresh build.
  const buildInputsFingerprint = computeBuildInputsFingerprint({
    dirs: [
      path.join(packageRoot, 'additions'),
      path.join(packageRoot, 'patches'),
    ],
    nodeVersion: nodeVersionRaw,
  })

  for (let i = 0, { length } = checkpointChain; i < length; i += 1) {
    const checkpoint = checkpointChain[i]
    // Check if this checkpoint exists
    const exists = hasCheckpoint(buildDir, packageName, checkpoint)

    if (exists) {
      logger.log('')
      logger.step('Progressive Checkpoint Restoration')
      logger.substep(`Found checkpoint: ${checkpoint}`)

      // If finalized, the build MAY already be complete — but only when
      // its saved build-inputs fingerprint still matches the current
      // additions/patches/node-version. A mismatch means the checkpoint
      // was saved against different inputs and must never be restored
      // silently.
      if (checkpoint === CHECKPOINTS.FINALIZED) {
        const checkpointData = await getCheckpointData(
          buildDir,
          packageName,
          checkpoint,
        )

        if (
          isCheckpointFingerprintCurrent({
            checkpointData,
            currentFingerprint: buildInputsFingerprint,
          })
        ) {
          resumeFromCheckpoint = checkpoint
          logger.success('Build already complete')
          logger.log('')
          return true
        }

        logger.warn(
          formatStaleCheckpointMessage({
            checkpointFile: path.join(
              buildDir,
              'checkpoints',
              ...(packageName ? [packageName] : []),
              `${checkpoint}.json`,
            ),
            checkpointName: checkpoint,
            currentFingerprint: buildInputsFingerprint,
            savedFingerprint: checkpointData?.inputsFingerprint,
          }),
        )
        logger.log('')
        break
      }

      resumeFromCheckpoint = checkpoint
      logger.substep(`Build will resume from ${checkpoint} checkpoint`)
      logger.log('')
      break
    }
  }

  if (!resumeFromCheckpoint) {
    logger.log('')
    logger.step('Starting Fresh Build')
    logger.substep('No checkpoints found - building from scratch')
    logger.log('')
  }

  return false
}
