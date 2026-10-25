/**
 * @file Preflight checks runner for build scripts.
 *   Provides a DRY way to run common pre-build validation checks.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  checkCompiler,
  checkDiskSpace,
  checkPythonVersion,
} from './build-operations.mts'
import { printError } from './build-output.mts'
import { getMinPythonVersion } from './version-metadata.mts'

const logger = getDefaultLogger()

export async function checkPreflightCompiler(
  compilers: string | string[] | undefined,
): Promise<string | undefined> {
  const compilerCheck = await checkCompiler(compilers)
  if (!compilerCheck.available) {
    return compilers
      ? `No C++ compiler found (tried: ${Array.isArray(compilers) ? compilers.join(', ') : compilers})`
      : 'No C++ compiler found'
  }
  return undefined
}

export async function checkPreflightDisk(
  diskGB: number,
): Promise<string | undefined> {
  const diskCheck = await checkDiskSpace('.', diskGB)
  if (!diskCheck.sufficient) {
    return `Insufficient disk space: ${diskCheck.availableGB}GB available, ${diskGB}GB required`
  }
  return undefined
}

export async function checkPreflightPython(
  version: string,
): Promise<string | undefined> {
  const pythonCheck = await checkPythonVersion(version)
  if (!pythonCheck.available) {
    return `Python ${version}+ not found`
  }
  return pythonCheck.sufficient
    ? undefined
    : `Python ${pythonCheck.version} is too old (${version}+ required)`
}

export function reportPreflightSummary(config: {
  failures: string[]
  quiet: boolean
}): void {
  const { failures, quiet } = { __proto__: null, ...config } as typeof config
  if (!quiet) {
    if (!failures.length) {
      logger.success('All preflight checks passed')
      logger.log('')
    } else {
      printError(`${failures.length} preflight check(s) failed`)
      logger.log('')
    }
  }
}

/**
 * Run preflight checks for build scripts.
 *
 * @param {object} options - Check options.
 * @param {boolean} [options.disk=true] - Check disk space.
 * @param {number} [options.diskGB=5] - Required disk space in GB.
 * @param {boolean} [options.compiler=false] - Check for C++ compiler.
 * @param {string | string[]} [options.compilers] - Specific compiler(s) to
 *   check.
 * @param {boolean} [options.python=false] - Check Python version.
 * @param {string} [options.pythonVersion] - Minimum Python version (defaults to
 *   build-requirements.json minimumVersion)
 * @param {boolean} [options.quiet=false] - Suppress output.
 * @param {boolean} [options.failFast=true] - Exit on first failure.
 *
 * @returns {Promise<{ passed: boolean; failures: string[] }>}
 */
export async function runPreflightChecks(options = {}) {
  const {
    compiler = false,
    compilers,
    disk = true,
    diskGB = 5,
    failFast = true,
    python = false,
    pythonVersion,
    quiet = false,
  } = options

  // Use single source of truth from build-requirements.json if no version specified
  const effectivePythonVersion = pythonVersion ?? getMinPythonVersion()

  const failures = []

  if (!quiet) {
    logger.step('Running preflight checks')
    logger.log('')
  }

  const checks = [
    { enabled: disk, run: () => checkPreflightDisk(diskGB) },
    { enabled: compiler, run: () => checkPreflightCompiler(compilers) },
    {
      enabled: python,
      run: () => checkPreflightPython(effectivePythonVersion),
    },
  ]
  for (let index = 0, { length } = checks; index < length; index += 1) {
    const check = checks[index]!
    if (!check.enabled) {
      continue
    }
    const failure = await check.run()
    if (failure) {
      failures.push(failure)
      if (!quiet) {
        printError(failure)
      }
      if (failFast) {
        return { __proto__: null, failures, passed: false }
      }
    }
  }

  reportPreflightSummary({ failures, quiet })

  return { __proto__: null, failures, passed: !failures.length }
}

/**
 * Run preflight checks and exit on failure.
 *
 * @param {object} options - Check options.
 *
 * @returns {Promise<void>}
 */
export async function runPreflightChecksOrExit(options = {}) {
  const result = await runPreflightChecks(options)

  if (!result.passed) {
    if (!options.quiet) {
      logger.error('Preflight checks failed')
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const failure of result.failures) {
        logger.error(`  - ${failure}`)
      }
    }
    throw new Error('Preflight checks failed')
  }
}
