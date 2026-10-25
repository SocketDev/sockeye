import { existsSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'

export function checkEmsdkInstalled(emsdkPath = getEmsdkPath()) {
  return (
    existsSync(path.join(emsdkPath, 'emsdk')) ||
    existsSync(path.join(emsdkPath, 'emsdk.bat'))
  )
}

export function ensureEmscriptenEnvironment(installPath) {
  const emsdkPath = installPath || getEmsdkPath()
  if (!process.env['EMSDK'] && checkEmsdkInstalled(emsdkPath)) {
    process.env['EMSDK'] = emsdkPath
  }
  if (process.env['EMSCRIPTEN']) {
    return
  }
  if (process.env['EMSDK']) {
    process.env['EMSCRIPTEN'] = path.join(
      process.env['EMSDK'],
      'upstream',
      'emscripten',
    )
    return
  }
  const emccPath = whichSync('emcc', { nothrow: true })
  if (!emccPath) {
    return
  }
  const resolvedEmcc = existsSync(emccPath) ? realpathSync(emccPath) : emccPath
  const emscriptenPath = path.dirname(resolvedEmcc)
  process.env['EMSCRIPTEN'] = emscriptenPath
  if (!process.env['EMSDK']) {
    const possibleEmsdk = path.resolve(emscriptenPath, '..', '..')
    if (checkEmsdkInstalled(possibleEmsdk)) {
      process.env['EMSDK'] = possibleEmsdk
    }
  }
}

export function getDefaultEmsdkPath() {
  return path.join(os.homedir(), '.emsdk')
}

export function getEmsdkPath() {
  return process.env['EMSDK'] || getDefaultEmsdkPath()
}

export function getEmsdkSpawnEnv() {
  const env = { ...process.env }
  // Linux only — macOS and Windows resolve a python that verifies fine
  // today, and overriding EMSDK_PYTHON / SSL vars there risks regressing a
  // working setup (macOS /etc/ssl/certs is empty, its system python has its
  // own CA wiring).
  if (process.platform === 'linux') {
    if (!env['EMSDK_PYTHON'] && existsSync('/usr/bin/python3')) {
      env['EMSDK_PYTHON'] = '/usr/bin/python3'
    }
    // Debian/Ubuntu (and most glibc distro) CA bundle path.
    const caBundle = '/etc/ssl/certs/ca-certificates.crt'
    if (!env['SSL_CERT_FILE'] && existsSync(caBundle)) {
      env['SSL_CERT_FILE'] = caBundle
    }
  }
  return env
}

export function parseEmsdkEnvironment(stdout, emsdkPath) {
  const envVars = {}
  if (stdout) {
    const lines = stdout.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(?<key>\w+)=(?<value>.*)$/)
      if (match) {
        const { key, value } = match.groups
        if (key === 'PATH' || key === 'EMSDK' || key.startsWith('EM_')) {
          envVars[key] = value
        }
      }
    }
  }
  if (!envVars.EMSDK) {
    envVars.EMSDK = emsdkPath
  }
  if (!envVars.EMSCRIPTEN) {
    envVars.EMSCRIPTEN = path.join(emsdkPath, 'upstream', 'emscripten')
  }
  return envVars
}
