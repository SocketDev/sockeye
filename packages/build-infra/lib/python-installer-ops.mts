import { getPinnedPackage } from './pinned-versions.mts'
import {
  getExpectedPythonVersion,
  getPythonInstallSpec,
} from './python-package-pin.mts'
import {
  getPythonInstallArgs,
  runPythonPipRetries,
} from './python-pip-retry.mts'
/**
 * Python package install/verify operations.
 *
 * Houses the install and verify functions for Python packages. Split from
 * python-installer.mts to keep each file under the 500-line soft cap.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { printError } from './build-output.mts'
import { errorMessage } from './error-utils.mts'
import {
  getPipCommand,
  getPythonCommand,
  initializeVenv,
  venvInitialized,
} from './python-installer.mts'

const logger = getDefaultLogger()

/**
 * Check if a Python package is installed.
 *
 * @param {string} packageName - Package name to check.
 *
 * @returns {Promise<boolean>} True if package is installed.
 */
export async function checkPythonPackage(packageName) {
  try {
    const pythonCmd = await getPythonCommand()
    if (!pythonCmd) {
      return false
    }
    const result = await spawn(pythonCmd, ['-c', `import ${packageName}`], {})
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if a Python package is installed with the correct pinned version.
 *
 * @param {string} packageName - Package name to check.
 * @param {string} expectedVersion - Expected version (e.g., '2.5.1').
 *
 * @returns {Promise<boolean>} True if package is installed with correct
 *   version.
 */
// Ordered by pip-install pipeline phase; alphabetizing would scatter it.
// oxlint-disable-next-line socket/sort-source-methods -- intentional ordering
export async function checkPythonPackageVersion(packageName, expectedVersion) {
  try {
    const pythonCmd = await getPythonCommand()
    if (!pythonCmd) {
      return false
    }
    const result = await spawn(
      pythonCmd,
      ['-c', `import ${packageName}; print(${packageName}.__version__)`],
      { stdio: 'pipe' },
    )
    const installedVersion = (result.stdout || '').trim()
    return installedVersion === expectedVersion
  } catch {
    return false
  }
}

/**
 * Install a Python package using pip.
 *
 * Uses venv if available (for PEP 668 compliant systems like Homebrew Python).
 * Falls back to --user mode if venv is not available.
 *
 * @param {string} packageName - Package name to install.
 * @param {object} options - Installation options.
 * @param {boolean} options.user - Install to user site-packages if no venv
 *   (--user flag).
 * @param {boolean} options.upgrade - Upgrade if already installed (--upgrade
 *   flag).
 * @param {boolean} options.quiet - Suppress output.
 * @param {string} options.consumerPackageJsonPath - Optional path to consumer
 *   package.json for version overrides.
 *
 * @returns {Promise<boolean>} True if installation succeeded.
 */
// Ordered by pip-install pipeline phase; alphabetizing would scatter it.
// oxlint-disable-next-line socket/sort-source-methods -- intentional ordering
export async function installPythonPackage(
  packageName,
  { consumerPackageJsonPath, quiet = false, upgrade = false, user = true } = {},
) {
  // Initialize venv if not already done (handles PEP 668)
  if (!venvInitialized) {
    await initializeVenv({ quiet })
  }

  const pip = getPipCommand()
  if (!pip) {
    if (!quiet) {
      printError('pip not found. Please install Python 3 with pip.')
    }
    return false
  }

  const pinnedPackage = getPythonInstallSpec({
    packageName,
    consumerPackageJsonPath,
  })

  if (!quiet) {
    logger.info(`Installing Python package: ${pinnedPackage}`)
  }

  try {
    const args = getPythonInstallArgs({ pinnedPackage, user, upgrade })

    // Set PyO3 forward compatibility flag for Python 3.14+ support.
    // This allows packages like tokenizers (which use Rust/PyO3) to build
    // on newer Python versions than officially supported by using the stable ABI.
    // See: https://github.com/huggingface/tokenizers/issues/1639
    const pipEnv = {
      ...process.env,
      PYO3_USE_ABI3_FORWARD_COMPATIBILITY: '1',
    }

    // In quiet mode we pipe so we can inspect stderr for a PEP 668
    // rejection token on systems where the on-disk marker check
    // misses (e.g. a distro that stages EXTERNALLY-MANAGED elsewhere).
    // In verbose mode we inherit so the user sees pip progress live;
    // the marker-file check above is the primary signal in that path.
    const spawnOptions = quiet
      ? { env: pipEnv, stdio: 'pipe' }
      : { env: pipEnv, stdio: 'inherit' }

    const exitCode = await runPythonPipRetries({
      pip,
      args,
      spawnOptions,
      packageName,
      quiet,
    })

    if (exitCode !== 0) {
      if (!quiet) {
        printError(`Failed to install ${packageName}`)
      }
      return false
    }

    if (!quiet) {
      logger.success(`Installed ${packageName}`)
    }
    return true
  } catch (e) {
    if (!quiet) {
      printError(`Error installing ${packageName}: ${errorMessage(e)}`)
    }
    return false
  }
}

/**
 * Ensure a Python package is installed, installing if needed.
 *
 * @param {string} packageName - Package name to check/install.
 * @param {object} options - Options.
 * @param {string} options.importName - Import name if different from package
 *   name.
 * @param {boolean} options.autoInstall - Attempt auto-installation if missing
 *   (default: true).
 * @param {boolean} options.quiet - Suppress output (default: false).
 * @param {string} options.consumerPackageJsonPath - Optional path to consumer
 *   package.json for version overrides.
 *
 * @returns {Promise<{ available: boolean; installed: boolean }>}
 */
// Ordered by pip-install pipeline phase; alphabetizing would scatter it.
// oxlint-disable-next-line socket/sort-source-methods -- intentional ordering
export async function ensurePythonPackage(
  packageName,
  {
    autoInstall = true,
    consumerPackageJsonPath,
    importName,
    quiet = false,
  } = {},
) {
  const checkName = importName || packageName

  const expectedVersion = getExpectedPythonVersion({
    packageName,
    consumerPackageJsonPath,
  })

  // Check if already installed with correct version
  const isInstalled = await checkPythonPackage(checkName)
  if (isInstalled && expectedVersion) {
    const hasCorrectVersion = await checkPythonPackageVersion(
      checkName,
      expectedVersion,
    )
    if (!hasCorrectVersion) {
      const reinstallResult = await retryPythonVersionMismatch({
        checkName,
        packageName,
        expectedVersion,
        quiet,
        autoInstall,
        consumerPackageJsonPath,
      })
      if (reinstallResult) {
        return reinstallResult
      }
    } else {
      return { __proto__: null, available: true, installed: false }
    }
  } else if (isInstalled) {
    // No version pinning for this package, accept whatever is installed
    return { __proto__: null, available: true, installed: false }
  }

  if (!autoInstall) {
    return { __proto__: null, available: false, installed: false }
  }

  // Attempt to install.
  if (!quiet) {
    logger.substep(
      `Python package '${packageName}' not found, attempting to install…`,
    )
  }

  const installed = await installPythonPackage(packageName, {
    consumerPackageJsonPath,
    quiet,
  })

  return { __proto__: null, available: installed, installed }
}

/**
 * Ensure all required Python packages are installed.
 *
 * @param {(string | { name: string; importName?: string })[]} packages -
 *   Packages to check.
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation (default:
 *   true).
 * @param {boolean} options.quiet - Suppress output (default: false).
 * @param {string} options.consumerPackageJsonPath - Optional path to consumer
 *   package.json for version overrides.
 *
 * @returns {Promise<{
 *   allAvailable: boolean
 *   missing: string[]
 *   installed: string[]
 * }>}
 */
// Ordered by pip-install pipeline phase; alphabetizing would scatter it.
// oxlint-disable-next-line socket/sort-source-methods -- intentional ordering
export async function ensureAllPythonPackages(
  packages,
  { autoInstall = true, consumerPackageJsonPath, quiet = false } = {},
) {
  const missing = []
  const installed = []

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i]
    const packageName = typeof pkg === 'string' ? pkg : pkg.name
    const importName = typeof pkg === 'string' ? undefined : pkg.importName

    if (!quiet && packages.length > 1) {
      logger.substep(`[${i + 1}/${packages.length}] Checking ${packageName}`)
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await ensurePythonPackage(packageName, {
        autoInstall,
        consumerPackageJsonPath,
        importName,
        quiet,
      })

      if (!result.available) {
        missing.push(packageName)
      } else if (result.installed) {
        installed.push(packageName)
      }
    } catch (e) {
      // ensurePythonPackage can throw from initializeVenv or from the
      // "No pinned version found" guard in installPythonPackage. Record
      // the package as missing and continue so the caller gets the full
      // picture instead of seeing the first exception abort the loop.
      if (!quiet) {
        logger.error(
          `Error checking Python package ${packageName}: ${errorMessage(e)}`,
        )
      }
      missing.push(packageName)
    }
  }

  reportPythonPackageSummary({ packages, quiet, missing, installed })

  return {
    __proto__: null,
    allAvailable: missing.length === 0,
    installed,
    missing,
  }
}

/**
 * Get installation instructions for Python packages.
 *
 * @param {string[]} packages - Package names.
 *
 * @returns {string[]} Array of installation instruction strings.
 */
// Ordered by pip-install pipeline phase; alphabetizing would scatter it.
// oxlint-disable-next-line socket/sort-source-methods -- intentional ordering
export function getPythonPackageInstructions(packages) {
  const pinnedPackages = packages.map(pkg => getPinnedPackage(pkg))
  const instructions = ['Install required Python packages:']
  instructions.push(`  pip3 install --user ${pinnedPackages.join(' ')}`)
  return instructions
}

export function reportPythonPackageSummary(config) {
  const { packages, quiet, missing, installed } = { __proto__: null, ...config }
  // Summary
  if (!quiet && packages.length > 1) {
    if (missing.length === 0) {
      logger.success(
        `All Python packages available (${packages.length}/${packages.length}${installed.length > 0 ? `, ${installed.length} newly installed` : ''})`,
      )
    } else {
      logger.warn(
        `${packages.length - missing.length}/${packages.length} Python packages available (${missing.length} missing: ${missing.join(', ')})`,
      )
    }
  }
}

export async function retryPythonVersionMismatch(config) {
  const {
    checkName,
    packageName,
    expectedVersion,
    quiet,
    autoInstall,
    consumerPackageJsonPath,
  } = { __proto__: null, ...config }
  const pythonCmd = await getPythonCommand()
  try {
    const result = await spawn(
      pythonCmd,
      ['-c', `import ${checkName}; print(${checkName}.__version__)`],
      { stdio: 'pipe' },
    )
    const installedVersion = (result.stdout || '').trim()
    if (!quiet) {
      logger.warn(
        `Python package '${packageName}' version mismatch: installed ${installedVersion}, expected ${expectedVersion}`,
      )
    }
    // Version mismatch - need to reinstall
    if (autoInstall) {
      if (!quiet) {
        logger.substep(`Reinstalling ${packageName} with pinned version…`)
      }
      const installed = await installPythonPackage(packageName, {
        consumerPackageJsonPath,
        quiet,
        upgrade: true,
      })
      return { __proto__: null, available: installed, installed }
    }
    return { __proto__: null, available: false, installed: false }
  } catch {
    // Could not check version, proceed with reinstall if autoInstall
  }
  return undefined
}
