import { promises as fs } from 'node:fs'
import process from 'node:process'
import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { printError } from './build-output.mts'
import { errorMessage } from './error-utils.mts'
import {
  getEmsdkPath,
  getEmsdkSpawnEnv,
  parseEmsdkEnvironment,
} from './emscripten-environment.mts'
const WIN32 = isWin32()
const logger = getDefaultLogger()

export async function activateEmsdkVersion(config) {
  const { emsdkPath, quiet, version } = {
    __proto__: null,
    ...config,
  } as typeof config
  const emsdkCmd = WIN32 ? 'emsdk.bat' : './emsdk'
  if (!quiet) {
    logger.info(`Activating Emscripten ${version}...`)
  }
  const result = await spawn(emsdkCmd, ['activate', version], {
    cwd: emsdkPath,
    env: getEmsdkSpawnEnv(),
    shell: WIN32,
    stdio: quiet ? 'pipe' : 'inherit',
  })
  if (result.code !== 0 && !quiet) {
    printError(`Failed to activate Emscripten ${version}`)
  }
  return result.code === 0
}

export async function cloneEmsdkCheckout(config) {
  const { emsdkPath, quiet } = { __proto__: null, ...config } as typeof config
  await fs.mkdir(emsdkPath, { recursive: true })
  if (!quiet) {
    logger.substep(`Cloning Emscripten SDK to ${emsdkPath}...`)
  }
  const result = await spawn(
    'git',
    ['clone', 'https://github.com/emscripten-core/emsdk.git', emsdkPath],
    { env: process.env, stdio: quiet ? 'pipe' : 'inherit' },
  )
  if (result.code !== 0 && !quiet) {
    printError('Failed to clone Emscripten SDK')
  }
  return result.code === 0
}

export async function installEmsdkVersion({
  emsdkPath,
  quiet = false,
  version = 'latest',
} = {}) {
  const resolvedEmsdkPath = emsdkPath || getEmsdkPath()
  const emsdkCmd = WIN32 ? 'emsdk.bat' : './emsdk'
  try {
    const installResult = await spawn(emsdkCmd, ['install', version], {
      cwd: resolvedEmsdkPath,
      env: getEmsdkSpawnEnv(),
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })
    return installResult.code === 0
  } catch (e) {
    if (!quiet) {
      printError(`Error installing Emscripten ${version}: ${errorMessage(e)}`)
    }
    return false
  }
}

export async function readEmsdkEnvironment(config) {
  const { emsdkPath, quiet } = { __proto__: null, ...config } as typeof config
  const constructEnvCmd = WIN32 ? 'emsdk_env.bat' : './emsdk_env.sh'
  const result = await spawn(
    WIN32 ? constructEnvCmd : 'bash',
    WIN32 ? [] : ['-c', `source ${constructEnvCmd} && env`],
    {
      cwd: emsdkPath,
      env: getEmsdkSpawnEnv(),
      shell: WIN32,
    },
  )
  if (result.code !== 0 && !quiet) {
    logger.warn('Failed to source Emscripten environment')
  }
  return parseEmsdkEnvironment(result.stdout, emsdkPath)
}
