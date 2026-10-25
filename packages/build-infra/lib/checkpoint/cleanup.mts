import { existsSync, promises as fs } from 'node:fs'
import { isCI } from '@socketsecurity/lib-stable/env/ci'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { withTryLock } from '../checkpoint-lock.mts'
import { errorMessage } from '../error-utils.mts'
import {
  getCheckpointArchiveFile,
  getCheckpointFile,
  getCheckpointLockPath,
} from './paths.mts'

const logger = getDefaultLogger()

export async function cleanupPreviousCheckpoint(
  checkpointDir: string,
  checkpointName: string,
  config: {
    checkpointChain: string[] | undefined
    artifactPath: string | undefined
  },
): Promise<void> {
  const { checkpointChain, artifactPath } = {
    __proto__: null,
    ...config,
  } as typeof config
  const runningInCI = isCI()

  if (artifactPath && checkpointChain && runningInCI) {
    try {
      const currentIndex = checkpointChain.indexOf(checkpointName)

      if (currentIndex !== -1 && currentIndex + 1 < checkpointChain.length) {
        const previousCheckpointName = checkpointChain[currentIndex + 1]

        if (previousCheckpointName) {
          const previousTarball = getCheckpointArchiveFile(
            checkpointDir,
            previousCheckpointName,
          )
          const previousJson = getCheckpointFile(
            checkpointDir,
            previousCheckpointName,
          )

          if (existsSync(previousTarball)) {
            // oxlint-disable-next-line socket/prefer-exists-sync -- need stats.size (gzip envelope check) and stats.mtimeMs (cleanup grace).
            const stats = await fs.stat(previousTarball)
            const isInvalidCheckpoint = stats.size === 0 || stats.size < 18

            const ageMs =
              stats.mtimeMs > Date.now() ? 0 : Date.now() - stats.mtimeMs
            const CLEANUP_GRACE_PERIOD_MS = 5 * 60 * 1000

            if (isInvalidCheckpoint || ageMs > CLEANUP_GRACE_PERIOD_MS) {
              const result = await withTryLock(
                getCheckpointLockPath(previousTarball),
                async (canDelete: boolean) => {
                  if (canDelete) {
                    logger.substep(
                      `Removing previous checkpoint: ${previousCheckpointName}.tar.gz (${Math.floor(ageMs / 60_000)}min old)`,
                    )
                    await safeDelete(previousTarball)
                    if (existsSync(previousJson)) {
                      await safeDelete(previousJson)
                    }
                  }
                  return canDelete
                },
              )
              if (result === false) {
                logger.substep(
                  `Checkpoint in use, skipping cleanup: ${previousCheckpointName}.tar.gz`,
                )
              } else if (result === undefined) {
                logger.substep(
                  `Cannot acquire lock, skipping cleanup: ${previousCheckpointName}.tar.gz`,
                )
              }
            } else {
              logger.substep(
                `Keeping recent checkpoint: ${previousCheckpointName}.tar.gz (${Math.floor(ageMs / 1000)}s old)`,
              )
            }
          }
        }
      }
    } catch (e) {
      logger.info(
        `Warning: Could not clean up previous checkpoint: ${errorMessage(e)}`,
      )
    }
  }
}
