import { existsSync, promises as fs, renameSync } from 'node:fs'
import process from 'node:process'
import { isErrnoException } from '@socketsecurity/lib-stable/errors/predicates'
import {
  safeDelete,
  safeDeleteSync,
  safeMkdir,
} from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { restoreCheckpointData } from './checkpoint/restore.mts'
import { computeBinaryCheckpointHash } from './checkpoint/cache-validation.mts'
import {
  getCheckpointCacheHashFile,
  getCheckpointDirectory,
  getCheckpointFile,
  getCheckpointTarballPath,
} from './checkpoint/paths.mts'
import { PLATFORM_AGNOSTIC_CHECKPOINTS } from './constants.mts'
import { errorMessage } from './error-utils.mts'
import {
  computeSourceHash,
  generateHashComment,
  shouldExtract,
} from './extraction-cache.mts'

/**
 * Build Checkpoint Manager.
 *
 * Provides utilities for saving and restoring build state to enable
 * incremental builds and faster iterations. These checkpoints are used
 * by GitHub Actions workflows to track build progress and enable caching
 * at each build phase.
 *
 * Also provides centralized cache key management for build source validation.
 */

const logger = getDefaultLogger()

/**
 * Checkpoint metadata persisted as `{phase}.json` next to the tarball.
 * Parsed back from disk, so every field is optional — older checkpoints
 * may predate newer fields.
 */
export interface CheckpointData {
  arch?: string | undefined
  artifactHash?: string | undefined
  artifactPath?: string | undefined
  buildMode?: string | undefined
  cacheHash?: string | undefined
  configureFlags?: string | undefined
  created?: string | undefined
  libc?: string | undefined
  name?: string | undefined
  nodeVersion?: string | undefined
  packageRoot?: string | undefined
  platform?: string | undefined
  sourcePaths?: string[] | undefined
  withLief?: boolean | undefined
  [key: string]: unknown
}

/**
 * Clean all workflow checkpoints for a package.
 *
 * @param {string} buildDir - Build directory path.
 * @param {string} packageName - Package name.
 *
 * @returns {Promise<void>}
 */
export async function cleanCheckpoint(buildDir: string, packageName: string) {
  logger.substep(`Cleaning checkpoints for ${packageName}`)

  const checkpointDir = getCheckpointDirectory(buildDir, packageName)

  await safeDelete(checkpointDir)
  logger.info('Checkpoints cleaned')
}

/**
 * Create a workflow checkpoint with artifacts and metadata. GitHub Actions
 * workflows track checkpoints to cache and resume each build phase.
 *
 * The smokeTest callback is REQUIRED so a checkpoint is only written after
 * the build artifacts are validated: build → smoke test → checkpoint.
 *
 * Binary-stage checkpoints must pass explicit target platform and arch —
 * host defaults silently mis-tag cache entries under cross-compilation.
 * Source-stage checkpoints in PLATFORM_AGNOSTIC_CHECKPOINTS skip both.
 *
 * When sourcePaths is set, the stored source hash decides whether a later
 * build can reuse this stage. When artifactPath is set, that file or
 * directory is archived as a tarball next to the metadata JSON under
 * build/{mode}/checkpoints/{package}/{phase}.
 *
 * Full discussion: docs/agents.md/repo/build-caching.md.
 */
export { createCheckpoint } from './checkpoint/create.mts'

/**
 * Get current cache hash for source files.
 *
 * @param {string[]} sourcePaths - Source file paths to hash.
 *
 * @returns {string} SHA256 hash (hex)
 */
export function getCacheHash(sourcePaths: string[]): string {
  return computeSourceHash(sourcePaths)
}

/**
 * Get cache validation hash file path.
 * Single source of truth for cache hash filename.
 *
 * @param {string} cacheDir - Cache directory path (e.g.,
 *   'build/dev/<platform-arch>/.cache')
 *
 * @returns {string} Cache hash file path
 */
export function getCacheHashFile(cacheDir: string): string {
  return getCheckpointCacheHashFile(cacheDir)
}

/**
 * Get checkpoint data.
 *
 * @param {string} buildDir - Build directory path.
 * @param {string} packageName - Package name.
 * @param {string} checkpointName - Checkpoint name.
 *
 * @returns {Promise<object | undefined>} Checkpoint data or undefined if not
 *   found.
 */
export async function getCheckpointData(
  buildDir: string,
  packageName: string,
  checkpointName: string,
): Promise<CheckpointData | undefined> {
  const checkpointDir = getCheckpointDirectory(buildDir, packageName)
  const checkpointFile = getCheckpointFile(checkpointDir, checkpointName)

  try {
    const content = await fs.readFile(checkpointFile, 'utf8')
    try {
      const parsed: unknown = JSON.parse(content)
      if (typeof parsed !== 'object' || parsed === null) {
        throw new TypeError('checkpoint JSON is not an object')
      }
      // JSON.parse returns `any`; the shape is an invariant of the writer
      // in this repo, and a malformed file throws in the surrounding
      // try/catch rather than flowing on.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed
      return parsed as CheckpointData
    } catch (e) {
      throw new Error(
        `Checkpoint file contains invalid JSON: ${checkpointFile}. ` +
          `File may be corrupted. Run with --clean to rebuild. Parse error: ${errorMessage(e)}`,
        { cause: e },
      )
    }
  } catch (e) {
    if (isErrnoException(e) && e.code === 'ENOENT') {
      // File doesn't exist - return undefined (checkpoint not found)
      return undefined
    }
    throw e
  }
}

/**
 * Check if a checkpoint exists.
 *
 * @param {string} buildDir - Build directory path.
 * @param {string} packageName - Package name.
 * @param {string} checkpointName - Checkpoint name.
 *
 * @returns {boolean}
 */
export function hasCheckpoint(
  buildDir: string,
  packageName: string,
  checkpointName: string,
): boolean {
  const checkpointDir = getCheckpointDirectory(buildDir, packageName)
  const checkpointFile = getCheckpointFile(checkpointDir, checkpointName)

  return existsSync(checkpointFile)
}

/**
 * List all checkpoints for a package.
 *
 * @param {string} buildDir - Build directory path.
 * @param {string} packageName - Package name.
 *
 * @returns {Promise<string[]>} Array of checkpoint names
 */
export async function listCheckpoints(
  buildDir: string,
  packageName: string,
): Promise<string[]> {
  const checkpointDir = getCheckpointDirectory(buildDir, packageName)

  try {
    const files = await fs.readdir(checkpointDir)
    return files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''))
      .toSorted()
  } catch {
    return []
  }
}

/**
 * Check if build cache is valid based on source file hashes.
 *
 * @param {string} cacheDir - Cache directory path.
 * @param {string[]} sourcePaths - Source file paths to validate.
 *
 * @returns {Promise<boolean>} True if cache needs rebuild, false if valid
 */
export async function needsCacheRebuild(
  cacheDir: string,
  sourcePaths: string | string[],
): Promise<boolean> {
  const hashFilePath = getCacheHashFile(cacheDir)
  return await shouldExtract({
    outputPath: hashFilePath,
    sourcePaths,
  })
}

/**
 * Clean a specific checkpoint.
 *
 * @param {string} buildDir - Build directory path.
 * @param {string} packageName - Package name.
 * @param {string} checkpointName - Checkpoint name.
 *
 * @returns {Promise<void>}
 */
export async function removeCheckpoint(
  buildDir: string,
  packageName: string,
  checkpointName: string,
): Promise<void> {
  const checkpointDir = getCheckpointDirectory(buildDir, packageName)
  const checkpointFile = getCheckpointFile(checkpointDir, checkpointName)
  // Also remove the companion tarball and its lock file so a later run
  // doesn't find a stale .tar.gz / .lock sitting next to a missing .json
  // (which would accumulate on dev machines across many clean-rebuild cycles).
  const tarballFile = getCheckpointTarballPath(checkpointFile)
  const lockFile = `${tarballFile}.lock`

  await Promise.allSettled([
    safeDelete(checkpointFile),
    safeDelete(tarballFile),
    safeDelete(lockFile),
  ])
}

/**
 * Restore checkpoint artifacts from the tarball to the artifactPath recorded
 * in checkpoint metadata, or to options.destDir when set.
 *
 * Deletes the existing target before extraction so a previous failed build
 * cannot leave a corrupt mix of old and new files.
 *
 * Expected platform, arch, and libc from options are checked against the
 * checkpoint metadata; a mismatch throws to prevent cross-target checkpoint
 * pollution. Resolves false when the checkpoint does not exist or fails an
 * integrity check.
 *
 * Full discussion: docs/agents.md/repo/build-caching.md.
 */
export interface RestoreCheckpointOptions {
  arch?: string | undefined
  destDir?: string | undefined
  libc?: string | undefined
  platform?: string | undefined
}

export async function restoreCheckpoint(
  buildDir: string,
  packageName: string,
  checkpointName: string,
  options: RestoreCheckpointOptions = {},
): Promise<boolean> {
  const checkpointData = await getCheckpointData(
    buildDir,
    packageName,
    checkpointName,
  )

  if (!checkpointData) {
    return false
  }

  return restoreCheckpointData(
    buildDir,
    packageName,
    checkpointName,
    checkpointData,
    options,
  )
}

/**
 * Check if build should run based on checkpoint, cache hash, and --force flag.
 *
 * @param {string} buildDir - Build directory path.
 * @param {string} packageName - Package name.
 * @param {string} checkpointName - Checkpoint name.
 * @param {object} [options] - Build options for cross-compilation validation.
 * @param {string} [options.platform] - Target platform (darwin, linux, win32)
 * @param {string} [options.arch] - Target architecture (x64, arm64)
 * @param {string} [options.libc] - Target libc (glibc, musl) for Linux.
 *
 * @returns {Promise<boolean>} True if should run, false if should skip
 */
export async function shouldRun(
  buildDir: string,
  packageName: string,
  checkpointName: string,
  options: {
    readonly force?: boolean | undefined
    readonly sourcePaths?: string[] | undefined
    readonly arch?: string | undefined
    readonly buildMode?: string | undefined
    readonly configureFlags?: string | undefined
    readonly libc?: string | undefined
    readonly nodeVersion?: string | undefined
    readonly platform?: string | undefined
    readonly withLief?: boolean | undefined
  } = {},
): Promise<boolean> {
  const { force = false, sourcePaths } = options
  if (force) {
    return true
  }

  const exists = hasCheckpoint(buildDir, packageName, checkpointName)

  if (!exists) {
    return true
  }

  // If checkpoint exists and sourcePaths provided, validate cache hash
  if (sourcePaths && Array.isArray(sourcePaths) && sourcePaths.length > 0) {
    const checkpointData = await getCheckpointData(
      buildDir,
      packageName,
      checkpointName,
    )

    // Force rebuild if checkpoint has no cache hash but we need to validate sources
    if (!checkpointData?.cacheHash) {
      logger.substep(
        `Checkpoint '${checkpointName}' exists but has no cache hash (sources need validation)`,
      )
      return true
    }

    // Source-stage checkpoints are platform-agnostic — same set as
    // createCheckpoint and restoreCheckpoint. Only binary compilation stages
    // need platform-specific cache keys.
    const isPlatformAgnostic = PLATFORM_AGNOSTIC_CHECKPOINTS.has(checkpointName)

    let currentCacheHash: string
    if (isPlatformAgnostic) {
      // Source checkpoints: validate ONLY source file content (no platform metadata)
      currentCacheHash = computeSourceHash(sourcePaths)
    } else {
      currentCacheHash = computeBinaryCheckpointHash(
        checkpointName,
        sourcePaths,
        options,
      )
    }

    if (currentCacheHash !== checkpointData.cacheHash) {
      logger.substep(
        `Checkpoint '${checkpointName}' exists but source files changed (cache invalidated)`,
      )
      return true
    }
  }

  logger.substep(
    `Checkpoint '${checkpointName}' exists and cache valid, skipping`,
  )
  return false
}

/**
 * Write cache validation hash file.
 *
 * @param {string} cacheDir - Cache directory path.
 * @param {string[]} sourcePaths - Source file paths to hash.
 *
 * @returns {Promise<void>}
 */
export async function writeCacheHash(
  cacheDir: string,
  sourcePaths: string | string[],
): Promise<void> {
  const hashFilePath = getCacheHashFile(cacheDir)

  // Ensure cache directory exists
  await safeMkdir(cacheDir)

  // Generate and write hash atomically
  const hashComment = generateHashComment(sourcePaths)
  const tempHashFile = `${hashFilePath}.tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tempHashFile, hashComment, 'utf8')
  try {
    renameSync(tempHashFile, hashFilePath)
  } catch (e) {
    // Handle concurrent builds writing same hash file
    if (isErrnoException(e) && (e.code === 'EEXIST' || e.code === 'EPERM')) {
      // Concurrent build already wrote hash file - safe to ignore since
      // deterministic builds produce identical hashes
      safeDeleteSync(tempHashFile)
      return
    }
    throw e
  }

  logger.info(`Cache hash: ${hashFilePath}`)
}
