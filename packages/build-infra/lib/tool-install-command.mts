import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { printError } from './build-output.mts'

const logger = getDefaultLogger()

export function createPinnedToolInstallCommand(config) {
  const { packageManager, packageName, version, autoYes } = {
    __proto__: null,
    ...config,
  }
  switch (packageManager) {
    case 'brew': {
      if (version) {
        logger.warn('Homebrew may not support version pinning for this tool')
      }
      return {
        __proto__: null,
        command: 'brew',
        args: ['install', packageName],
      }
    }
    case 'apt':
    case 'apk':
    case 'yum':
    case 'dnf': {
      return createUnixToolInstallCommand(config)
    }
    case 'choco': {
      const args = version
        ? ['install', packageName, '--version', version, autoYes ? '-y' : '']
        : ['install', packageName, autoYes ? '-y' : '']
      return { __proto__: null, command: 'choco', args: args.filter(Boolean) }
    }
    case 'scoop': {
      const scoopPackage = version ? `${packageName}@${version}` : packageName
      return {
        __proto__: null,
        command: 'scoop',
        args: ['install', scoopPackage],
      }
    }
    default: {
      printError(`Unsupported package manager: ${packageManager}`)
      return undefined
    }
  }
}

export function createUnixToolInstallCommand(config) {
  const { packageManager, packageName, platform, version } = {
    __proto__: null,
    ...config,
  }
  let binary
  let args
  switch (packageManager) {
    case 'apt': {
      binary = 'apt-get'
      args = [
        'install',
        '-y',
        version ? `${packageName}=${version}*` : packageName,
      ]
      break
    }
    case 'apk': {
      binary = 'apk'
      args = [
        'add',
        '--no-cache',
        version ? `${packageName}=${version}` : packageName,
      ]
      break
    }
    case 'yum':
    case 'dnf': {
      binary = packageManager
      args = [
        'install',
        '-y',
        version ? `${packageName}-${version}` : packageName,
      ]
      break
    }
    default: {
      throw new Error(`Unsupported Unix package manager: ${packageManager}`)
    }
  }
  const needsSudo = platform !== 'win32'
  return {
    __proto__: null,
    command: needsSudo ? 'sudo' : binary,
    args: needsSudo ? [binary, ...args] : args,
  }
}
