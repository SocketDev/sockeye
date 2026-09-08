import { closeSync, openSync, promises as fs, readSync } from 'node:fs'
import path from 'node:path'
import { isErrnoException } from '@socketsecurity/lib-stable/errors/predicates'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import type {
  CheckpointData,
  RestoreCheckpointOptions,
} from '../checkpoint-manager.mts'
import { withLock } from '../checkpoint-lock.mts'
import { PLATFORM_AGNOSTIC_CHECKPOINTS } from '../constants.mts'
import { errorMessage } from '../error-utils.mts'
import { computeSourceHash } from '../extraction-cache.mts'
import { extractTarball } from '../tarball-utils.mts'
import {
  getCheckpointArtifactPath,
  getCheckpointDirectory,
  getCheckpointExtractionTarget,
  getCheckpointFile,
  getCheckpointLockPath,
  getCheckpointTarballPath,
} from './paths.mts'

const logger = getDefaultLogger()

export interface CheckpointExtractionConfig {
  readonly tarballPath: string
  readonly extractDir: string
  readonly targetPath: string
  readonly initialModTime: number
  readonly artifactHash: string | undefined
}

export async function extractCheckpointWithRetry(
  config: CheckpointExtractionConfig,
): Promise<void> {
  const { tarballPath, extractDir, targetPath, initialModTime, artifactHash } =
    { __proto__: null, ...config } as CheckpointExtractionConfig
  let extractAttempts = 0
  const MAX_EXTRACT_ATTEMPTS = 3
  let extractError: unknown

  while (extractAttempts < MAX_EXTRACT_ATTEMPTS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await withLock(getCheckpointLockPath(tarballPath), 'sh', async () => {
        await extractLockedCheckpoint({
          tarballPath,
          extractDir,
          targetPath,
          initialModTime,
          artifactHash,
        })
      })
      extractError = undefined
      break
    } catch (e) {
      extractError = e
      extractAttempts++
    }

    if (extractError) {
      const errCode = isErrnoException(extractError)
        ? extractError.code
        : undefined
      const errMsg = errorMessage(extractError)

      if (errCode === 'ENOENT' || errMsg.includes('ENOENT')) {
        const ageMs = Math.max(0, Date.now() - initialModTime)
        if (ageMs > 5 * 60 * 1000) {
          throw new Error(
            `Checkpoint was permanently deleted by cleanup (${Math.floor(ageMs / 60_000)}min old): ${tarballPath}. ` +
              'Rebuild with --clean to create fresh checkpoints.',
          )
        }

        if (extractAttempts < MAX_EXTRACT_ATTEMPTS) {
          logger.warn(
            `Checkpoint deleted during restoration, retrying (${extractAttempts}/${MAX_EXTRACT_ATTEMPTS})...`,
          )
          // eslint-disable-next-line no-await-in-loop
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * extractAttempts),
          )
          continue
        }
      }

      break
    }
  }

  if (extractError) {
    const errCode = isErrnoException(extractError)
      ? extractError.code
      : undefined
    const errMsg = errorMessage(extractError)
    if (errCode === 'ENOENT' || errMsg.includes('ENOENT')) {
      throw new Error(
        `Checkpoint was deleted during restoration after ${MAX_EXTRACT_ATTEMPTS} attempts: ${tarballPath}. ` +
          'This may indicate concurrent builds or checkpoint cleanup. ' +
          'Try rebuilding with --clean to create fresh checkpoints.',
      )
    }
    throw new Error(`Checkpoint extraction failed: ${errMsg}`)
  }
}

export async function extractLockedCheckpoint(
  config: CheckpointExtractionConfig,
): Promise<void> {
  const { tarballPath, extractDir, targetPath, initialModTime, artifactHash } =
    { __proto__: null, ...config } as CheckpointExtractionConfig
  // oxlint-disable-next-line socket/prefer-exists-sync -- size and mtime
  const preExtractStats = await fs.stat(tarballPath)
  if (preExtractStats.size === 0) {
    throw new Error('Checkpoint file became empty before extraction')
  }

  const MTIME_CHANGE_THRESHOLD_MS = 1000
  const mtimeDelta = Math.abs(preExtractStats.mtimeMs - initialModTime)
  if (mtimeDelta > MTIME_CHANGE_THRESHOLD_MS) {
    throw new Error(
      'Checkpoint was replaced during restoration (mtime changed). ' +
        'This indicates concurrent builds creating new checkpoints. ' +
        'Rebuild with --clean to create fresh checkpoints.',
    )
  }

  await extractTarball(tarballPath, extractDir)

  const extractedHash = computeSourceHash([targetPath], undefined, {
    relativeTo: extractDir,
  })

  if (!artifactHash) {
    throw new Error(
      'Checkpoint missing artifactHash (legacy checkpoint format). ' +
        'Rebuild with --clean to create checkpoints with hash validation.',
    )
  }

  if (extractedHash !== artifactHash) {
    throw new Error(
      'Extracted checkpoint hash mismatch - concurrent modification detected. ' +
        `Expected: ${artifactHash}, Got: ${extractedHash}. ` +
        'Rebuild with --clean to create fresh checkpoints.',
    )
  }
}

export async function restoreCheckpointData(
  buildDir: string,
  packageName: string,
  checkpointName: string,
  checkpointData: CheckpointData,
  options: RestoreCheckpointOptions = {},
): Promise<boolean> {
  validateCheckpointRestoreTarget(checkpointData, checkpointName, options)

  const checkpointDir = getCheckpointDirectory(buildDir, packageName)
  const checkpointFile = getCheckpointFile(checkpointDir, checkpointName)

  logger.substep(`Restoring checkpoint '${checkpointName}'`)

  if (checkpointData.artifactPath) {
    const tarballPath = getCheckpointTarballPath(checkpointFile)
    const artifactPath = getCheckpointArtifactPath(
      buildDir,
      checkpointData.artifactPath,
    )

    const normalized = path.normalize(artifactPath)
    const normalizedBuildDir = path.normalize(buildDir)
    if (
      !normalized.startsWith(normalizedBuildDir + path.sep) &&
      normalized !== normalizedBuildDir
    ) {
      throw new Error(
        `Checkpoint artifactPath escapes build directory: ${checkpointData.artifactPath}`,
      )
    }

    try {
      // oxlint-disable-next-line socket/prefer-exists-sync -- see above
      const stats = await fs.stat(tarballPath)
      const initialModTime = stats.mtimeMs
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

      if (!validateCheckpointGzip(tarballPath, stats.size)) {
        return false
      }

      logger.info(`Extracting checkpoint.tar.gz (${sizeMB} MB)...`)

      const extractDir = options.destDir || path.dirname(artifactPath)
      const targetPath = getCheckpointExtractionTarget(
        artifactPath,
        options.destDir,
      )

      await safeDelete(targetPath)
      if (options.destDir) {
        logger.info(
          `Cleaned existing artifact: ${path.basename(targetPath)} (custom destination)`,
        )
      } else {
        logger.info(`Cleaned existing artifact: ${path.basename(artifactPath)}`)
      }

      await extractCheckpointWithRetry({
        tarballPath,
        extractDir,
        targetPath,
        initialModTime,
        artifactHash: checkpointData.artifactHash,
      })

      let extractedStats
      try {
        // oxlint-disable-next-line socket/prefer-exists-sync -- size and type required
        extractedStats = await fs.stat(targetPath)
      } catch (e) {
        if (isErrnoException(e) && e.code === 'ENOENT') {
          throw new Error(
            `Checkpoint extraction failed: expected artifact not found after extraction: ${path.basename(targetPath)}`,
          )
        }
        throw e
      }

      if (extractedStats.isFile() && extractedStats.size === 0) {
        throw new Error(
          `Checkpoint extraction failed: artifact is empty after extraction: ${path.basename(targetPath)}`,
        )
      }

      if (options.destDir) {
        logger.info(
          `Restored: ${path.basename(artifactPath)} → ${extractDir} (custom destination)`,
        )
      } else {
        logger.info(`Restored: ${path.basename(artifactPath)} → ${extractDir}`)
      }
    } catch (e) {
      throw new Error(
        `Checkpoint restoration failed for ${path.basename(artifactPath)}: ${errorMessage(e)}. ` +
          'Build artifacts may be corrupted. Try cleaning checkpoints and rebuilding.',
        { cause: e },
      )
    }
  }

  return true
}

export function validateCheckpointGzip(
  tarballPath: string,
  size: number,
): boolean {
  const sizeMB = (size / 1024 / 1024).toFixed(2)
  if (size === 0) {
    logger.warn(`Checkpoint file is empty: ${tarballPath}`)
    return false
  }

  const MAX_CHECKPOINT_SIZE = 2 * 1024 * 1024 * 1024
  if (size > MAX_CHECKPOINT_SIZE) {
    logger.warn(
      `Checkpoint exceeds maximum size: ${sizeMB}MB > 2048MB (may be corrupted): ${tarballPath}`,
    )
    return false
  }

  try {
    if (size < 18) {
      logger.warn(
        `Checkpoint file too small to be valid gzip (${size} bytes): ${tarballPath}`,
      )
      return false
    }

    const fd = openSync(tarballPath, 'r')
    try {
      const headerBuffer = Buffer.alloc(2)
      readSync(fd, headerBuffer, 0, 2, 0)

      if (headerBuffer[0] !== 0x1f || headerBuffer[1] !== 0x8b) {
        logger.warn(
          `Checkpoint file is not a valid gzip archive: ${tarballPath}`,
        )
        return false
      }

      const footerBuffer = Buffer.alloc(8)
      readSync(fd, footerBuffer, 0, 8, size - 8)

      const crc32 = footerBuffer.readUInt32LE(0)
      const isize = footerBuffer.readUInt32LE(4)

      if (crc32 === 0 && isize === 0) {
        logger.warn(
          `Checkpoint gzip footer is invalid (likely truncated file): ${tarballPath}`,
        )
        return false
      }
    } finally {
      closeSync(fd)
    }
  } catch (e) {
    logger.warn(`Failed to validate checkpoint file: ${errorMessage(e)}`)
    return false
  }

  return true
}

export function validateCheckpointRestoreTarget(
  checkpointData: CheckpointData,
  checkpointName: string,
  config: RestoreCheckpointOptions,
): void {
  const options = { __proto__: null, ...config } as RestoreCheckpointOptions
  if (
    options.platform &&
    checkpointData.platform &&
    options.platform !== checkpointData.platform
  ) {
    throw new Error(
      `Checkpoint platform mismatch: expected ${options.platform}, got ${checkpointData.platform}. ` +
        'Cannot restore checkpoint across platforms. Run with --clean to rebuild for target platform.',
    )
  }

  if (
    options.arch &&
    checkpointData.arch &&
    options.arch !== checkpointData.arch
  ) {
    throw new Error(
      `Checkpoint arch mismatch: expected ${options.arch}, got ${checkpointData.arch}. ` +
        'Cannot restore checkpoint across architectures. Run with --clean to rebuild for target architecture.',
    )
  }

  const isSourceCheckpoint = PLATFORM_AGNOSTIC_CHECKPOINTS.has(checkpointName)

  if (!isSourceCheckpoint) {
    if (options.platform === 'linux' && !options.libc) {
      throw new Error(
        `Checkpoint restoration for Linux requires libc parameter. ` +
          'Specify options.libc = "glibc" or "musl" to prevent cross-libc checkpoint pollution.',
      )
    }

    if (checkpointData.platform === 'linux' && !checkpointData.libc) {
      throw new Error(
        `Checkpoint for Linux platform missing libc metadata: ${checkpointName}. ` +
          'This checkpoint was created without libc specification and cannot be safely restored. ' +
          'Rebuild with --clean to create checkpoints with proper libc metadata.',
      )
    }

    if (
      options.libc &&
      checkpointData.libc &&
      options.libc !== checkpointData.libc
    ) {
      throw new Error(
        `Checkpoint libc mismatch: expected ${options.libc}, got ${checkpointData.libc}. ` +
          'Cannot restore checkpoint across libc implementations. Run with --clean to rebuild for target libc.',
      )
    }
  }
}
