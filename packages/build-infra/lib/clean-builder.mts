/**
 * Shared clean utility for builder packages.
 *
 * Provides a standardized way to clean build artifacts and checkpoints
 * across all builder packages (onnxruntime, yoga-layout, models, etc.).
 *
 * @module clean-builder
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { cleanCheckpoint } from './checkpoint-manager.mts'
import {
  builderCheckpointModePath,
  builderCleanDirectoryPath,
  builderPackageFromCallerPath,
} from './paths.mts'

const logger = getDefaultLogger()

/**
 * Clean build artifacts for a builder package.
 *
 * @example
 *   // Basic usage (cleans build/ and checkpoints for prod/dev)
 *   await cleanBuilder('onnxruntime-builder')
 *
 * @example
 *   // Custom directories
 *   await cleanBuilder('models', {
 *     cleanDirs: ['build', 'dist'],
 *     packageDir: path.join(__dirname, '..'),
 *   })
 *
 * @example
 *   // No checkpoint cleaning
 *   await cleanBuilder('node-smol-builder', {
 *     checkpointModes: [],
 *   })
 *
 * @param {string} packageName - Display name for logging (e.g.,
 *   'onnxruntime-builder')
 * @param {object} options - Configuration options.
 * @param {string} options.packageDir - Absolute path to package root (default:
 *   caller's parent dir)
 * @param {string[]} options.cleanDirs - Directories to delete relative to
 *   packageDir (default: ['build'])
 * @param {string[]} options.checkpointModes - Modes to clean checkpoints for
 *   (default: ['prod', 'dev'])
 * @param {string} options.buildDir - Build directory name for checkpoints
 *   (default: 'build')
 * @param {object} options.logger - Custom logger instance (default:
 *   getDefaultLogger())
 *
 * @returns {Promise<void>}
 */
export async function cleanBuilder(packageName, options = {}) {
  const activeLogger = options.logger || logger

  // Resolve package directory (default: caller's parent directory)
  let { packageDir } = options
  if (!packageDir) {
    // Auto-detect from caller's location (typically scripts/clean.mts)
    const stackLines = new Error().stack?.split(/\r?\n/) || []
    const callerUrl =
      stackLines.length > 2
        ? stackLines[2].match(/\(([^)]+)\)/)?.[1]
        : undefined
    if (callerUrl) {
      const callerPath = fileURLToPath(callerUrl)
      packageDir = builderPackageFromCallerPath(callerPath)
    } else {
      throw new Error('packageDir must be provided or auto-detectable')
    }
  }

  const {
    buildDir = 'build',
    checkpointModes = ['prod', 'dev'],
    cleanDirs = ['build'],
  } = options

  activeLogger.info(`Cleaning ${packageName}…`)

  let cleanedCount = 0

  // Delete each specified directory
  for (let i = 0, { length } = cleanDirs; i < length; i += 1) {
    const dir = cleanDirs[i]
    const dirPath = builderCleanDirectoryPath(packageDir, dir)
    if (existsSync(dirPath)) {
      // eslint-disable-next-line no-await-in-loop
      await safeDelete(dirPath)
      activeLogger.success(`Removed ${dir}/`)
      cleanedCount++
    }
  }

  cleanedCount += await cleanBuilderCheckpoints({
    packageDir,
    buildDir,
    checkpointModes,
    logger: activeLogger,
  })

  if (cleanedCount === 0) {
    activeLogger.info('Nothing to clean')
  } else {
    activeLogger.success('Clean complete')
  }
}

export async function cleanBuilderCheckpoints(config) {
  const {
    packageDir,
    buildDir,
    checkpointModes,
    logger: activeLogger,
  } = {
    __proto__: null,
    ...config,
  }
  if (checkpointModes.length === 0) {
    return 0
  }
  for (let i = 0, { length } = checkpointModes; i < length; i += 1) {
    const modeDirPath = builderCheckpointModePath(
      packageDir,
      buildDir,
      checkpointModes[i],
    )
    await cleanCheckpoint(modeDirPath, '')
  }
  activeLogger.success('Cleaned checkpoints')
  return 1
}
