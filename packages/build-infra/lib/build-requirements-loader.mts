/**
 * Loaders for build-requirements.json — the pinned tool version registry.
 *
 * Sync and async variants for both package-local and monorepo-root lookups. All
 * loaders throw with What/Where/Fix context instead of defaulting to 'latest'.
 */

import { promises as fs, readFileSync } from 'node:fs'
import { getBuildRequirementsPath } from './paths.mts'

import { errorMessage } from './error-utils.mts'
import { isErrnoException } from '@socketsecurity/lib-stable/errors/predicates'

/**
 * Load and parse build-requirements.json.
 *
 * @param {string} packageRoot - Absolute path to package root.
 *
 * @returns {Promise<object>} Parsed build-requirements.json
 *
 * @throws {Error} If file doesn't exist or is malformed
 */
export async function loadExternalTools(packageRoot: string) {
  const externalToolsPath = getBuildRequirementsPath(packageRoot)

  try {
    const content = await fs.readFile(externalToolsPath, 'utf8')
    return JSON.parse(content)
  } catch (e) {
    if (isErrnoException(e) && e.code === 'ENOENT') {
      throw new Error(
        `build-requirements.json not found at: ${externalToolsPath}\n` +
          'Please ensure build-requirements.json exists in the package root.',
        { cause: e },
      )
    }
    if (e instanceof SyntaxError) {
      throw new Error(
        `Malformed JSON in build-requirements.json at: ${externalToolsPath}\n` +
          `Parse error: ${errorMessage(e)}`,
        { cause: e },
      )
    }
    throw e
  }
}

/**
 * Load and parse build-requirements.json synchronously.
 *
 * @param {string} packageRoot - Absolute path to package root.
 *
 * @returns {object} Parsed build-requirements.json
 *
 * @throws {Error} If file doesn't exist or is malformed
 */
export function loadExternalToolsSync(packageRoot: string) {
  const externalToolsPath = getBuildRequirementsPath(packageRoot)

  try {
    const content = readFileSync(externalToolsPath, 'utf8')
    return JSON.parse(content)
  } catch (e) {
    if (isErrnoException(e) && e.code === 'ENOENT') {
      throw new Error(
        `build-requirements.json not found at: ${externalToolsPath}\n` +
          'Please ensure build-requirements.json exists in the package root.',
        { cause: e },
      )
    }
    if (e instanceof SyntaxError) {
      throw new Error(
        `Malformed JSON in build-requirements.json at: ${externalToolsPath}\n` +
          `Parse error: ${errorMessage(e)}`,
        { cause: e },
      )
    }
    throw e
  }
}
