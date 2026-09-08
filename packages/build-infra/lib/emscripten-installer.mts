/**
 * Emscripten SDK Installation Utilities.
 *
 * Provides utilities for automatically installing and activating Emscripten
 * SDK.
 */

import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { printError } from './build-output.mts'
import { errorMessage } from './error-utils.mts'

import {
  checkEmsdkInstalled,
  ensureEmscriptenEnvironment,
  getDefaultEmsdkPath,
  getEmsdkPath,
} from './emscripten-environment.mts'
import {
  activateEmsdkVersion,
  cloneEmsdkCheckout,
  installEmsdkVersion,
  readEmsdkEnvironment,
} from './emscripten-commands.mts'
export {
  checkEmsdkInstalled,
  getDefaultEmsdkPath,
  getEmsdkPath,
  getEmsdkSpawnEnv,
} from './emscripten-environment.mts'
export { installEmsdkVersion } from './emscripten-commands.mts'

const logger = getDefaultLogger()

/**
 * Activate Emscripten SDK environment for current process.
 *
 * @param {object} options - Options.
 * @param {string} options.emsdkPath - Emscripten SDK path (default:
 *   auto-detect).
 * @param {string} options.version - Version to activate (default: 'latest').
 * @param {boolean} options.quiet - Suppress output.
 *
 * @returns {Promise<{ activated: boolean; env: object }>}
 */
export async function activateEmscripten({
  emsdkPath,
  quiet = false,
  version = 'latest',
} = {}) {
  const resolvedEmsdkPath = emsdkPath || getEmsdkPath()

  if (!checkEmsdkInstalled(resolvedEmsdkPath)) {
    if (!quiet) {
      printError(`Emscripten SDK not found at ${resolvedEmsdkPath}`)
    }
    return { __proto__: null, activated: false, env: {} }
  }

  try {
    if (
      !(await activateEmsdkVersion({
        emsdkPath: resolvedEmsdkPath,
        quiet,
        version,
      }))
    ) {
      return { __proto__: null, activated: false, env: {} }
    }
    const envVars = await readEmsdkEnvironment({
      emsdkPath: resolvedEmsdkPath,
      quiet,
    })

    // Apply to current process environment.
    Object.assign(process.env, envVars)

    if (!quiet) {
      logger.success(`Emscripten ${version} activated`)
    }

    return { __proto__: null, activated: true, env: envVars }
  } catch (e) {
    if (!quiet) {
      printError(`Error activating Emscripten: ${errorMessage(e)}`)
    }
    return { __proto__: null, activated: false, env: {} }
  }
}

export async function activateExistingEmsdk(config) {
  const { emsdkPath, quiet, version, autoInstall } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (!quiet) {
    logger.substep('Emscripten SDK found, activating…')
  }
  let activation = await activateEmscripten({
    emsdkPath,
    quiet,
    version,
  })
  let repaired = false
  if (!activation.activated && autoInstall) {
    // An emsdk checkout can exist while the requested version's tools are
    // missing — an interrupted `emsdk install`, or a sibling build process
    // cloned the SDK moments ago and is still installing. Activate then
    // fails with "tool is not installed and therefore cannot be
    // activated". `emsdk install` is idempotent (already-installed tools
    // are skipped), so install the version and retry activation once.
    if (!quiet) {
      logger.substep(
        `Activation failed — running emsdk install ${version} and retrying…`,
      )
    }
    repaired = await installEmsdkVersion({ emsdkPath, quiet, version })
    if (repaired) {
      activation = await activateEmscripten({ emsdkPath, quiet, version })
    }
  }
  return {
    __proto__: null,
    activated: activation.activated,
    available: activation.activated,
    installed: repaired,
  }
}

/**
 * Check if Emscripten is available.
 *
 * @returns {boolean} True if emcc is in PATH.
 */
export function checkEmscriptenAvailable() {
  return Boolean(whichSync('emcc', { nothrow: true }))
}

/**
 * Ensure Emscripten is available, installing if needed.
 *
 * @param {object} options - Options.
 * @param {string} options.version - Version to install (default: 'latest').
 * @param {string} options.installPath - Installation path (default:
 *   auto-detect).
 * @param {boolean} options.autoInstall - Attempt auto-installation (default:
 *   true).
 * @param {boolean} options.quiet - Suppress output (default: false).
 *
 * @returns {Promise<{
 *   available: boolean
 *   installed: boolean
 *   activated: boolean
 * }>}
 */
export async function ensureEmscripten({
  autoInstall = true,
  installPath,
  quiet = false,
  version = 'latest',
} = {}) {
  // Check if emcc is already in PATH.
  if (checkEmscriptenAvailable()) {
    ensureEmscriptenEnvironment(installPath)
    return {
      __proto__: null,
      activated: false,
      available: true,
      installed: false,
    }
  }

  const emsdkPath = installPath || getEmsdkPath()

  // Check if emsdk is installed but not activated.
  if (checkEmsdkInstalled(emsdkPath)) {
    return activateExistingEmsdk({ emsdkPath, quiet, version, autoInstall })
  }

  if (!autoInstall) {
    return {
      __proto__: null,
      activated: false,
      available: false,
      installed: false,
    }
  }

  // Install Emscripten SDK.
  if (!quiet) {
    logger.substep('Emscripten not found, installing…')
  }

  const installed = await installEmscripten({
    installPath: emsdkPath,
    quiet,
    version,
  })
  if (!installed) {
    return {
      __proto__: null,
      activated: false,
      available: false,
      installed: false,
    }
  }

  // Activate after installation.
  const activation = await activateEmscripten({
    emsdkPath,
    quiet,
    version,
  })

  return {
    __proto__: null,
    activated: activation.activated,
    available: activation.activated,
    installed: true,
  }
}

/**
 * Get Emscripten installation instructions.
 *
 * @param {object} options - Options.
 * @param {string} options.installPath - Installation path suggestion.
 *
 * @returns {string[]} Array of installation instruction strings.
 */
export function getEmscriptenInstructions({ installPath } = {}) {
  const emsdkPath = installPath || getDefaultEmsdkPath()
  return [
    'Install Emscripten SDK:',
    `  git clone https://github.com/emscripten-core/emsdk.git ${emsdkPath}`,
    `  cd ${emsdkPath}`,
    '  ./emsdk install latest',
    '  ./emsdk activate latest',
    `  source ${emsdkPath}/emsdk_env.sh`,
  ]
}

/**
 * Install Emscripten SDK.
 *
 * @param {object} options - Installation options.
 * @param {string} options.version - Version to install (default: 'latest').
 * @param {string} options.installPath - Installation path (default: ~/.emsdk).
 * @param {boolean} options.quiet - Suppress output.
 *
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installEmscripten({
  installPath,
  quiet = false,
  version = 'latest',
} = {}) {
  const emsdkPath = installPath || getDefaultEmsdkPath()

  // Check if git is available.
  if (!whichSync('git', { nothrow: true })) {
    if (!quiet) {
      printError('git is required to install Emscripten SDK')
    }
    return false
  }

  try {
    if (!(await cloneEmsdkCheckout({ emsdkPath, quiet }))) {
      return false
    }

    // Run emsdk install.
    if (!quiet) {
      logger.info(`Installing Emscripten ${version}...`)
    }

    const installed = await installEmsdkVersion({
      emsdkPath,
      quiet,
      version,
    })

    if (!installed) {
      if (!quiet) {
        printError(`Failed to install Emscripten ${version}`)
      }
      return false
    }

    if (!(await activateEmsdkVersion({ emsdkPath, quiet, version }))) {
      return false
    }

    if (!quiet) {
      logger.success(`Emscripten SDK ${version} installed successfully`)
      logger.warn(`Add to your environment: source ${emsdkPath}/emsdk_env.sh`)
    }

    return true
  } catch (e) {
    if (!quiet) {
      printError(`Error installing Emscripten: ${errorMessage(e)}`)
    }
    return false
  }
}
