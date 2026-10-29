import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'

export async function resolveMacosSdkPath(): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new Error('Sockeye native builds require the macOS SDK')
  }
  const result = await spawn('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
    cwd: REPO_ROOT,
  })
  if (result.code !== 0) {
    throw new Error(
      `macOS SDK resolution failed at xcrun: saw exit ${result.code}; wanted an installed macOS SDK. Install or select Xcode Command Line Tools.`,
    )
  }
  const sdk = result.stdout.trim()
  if (!path.isAbsolute(sdk) || !(await stat(sdk)).isDirectory()) {
    throw new Error(
      `macOS SDK resolution failed at xcrun: saw ${sdk || 'empty output'}, wanted an absolute SDK directory. Install the Xcode command-line tools.`,
    )
  }
  return sdk
}

export function isCmakeSdkCacheCurrent(
  cacheContents: string,
  sdk: string,
): boolean {
  const cacheSdk = /^CMAKE_OSX_SYSROOT:PATH=(?<sdk>.+)$/mu.exec(cacheContents)
    ?.groups?.['sdk']
  if (cacheSdk !== sdk) {
    return false
  }
  const frameworkPaths = cacheContents.matchAll(
    /^\w+_FRAMEWORK:FILEPATH=(?<frameworkPath>.+)$/gmu,
  )
  const frameworkRoot = `${path.join(
    normalizePath(sdk),
    'System',
    'Library',
    'Frameworks',
  )}${path.sep}`
  return [...frameworkPaths].every(match =>
    normalizePath(match.groups?.['frameworkPath'] ?? '').startsWith(
      frameworkRoot,
    ),
  )
}

export async function getCmakeSdkConfigureArgs(
  buildDirectory: string,
  sdk: string,
): Promise<string[]> {
  let cacheContents: string
  try {
    cacheContents = await readFile(
      path.join(buildDirectory, 'CMakeCache.txt'),
      'utf8',
    )
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return []
    }
    throw error
  }
  return isCmakeSdkCacheCurrent(cacheContents, sdk) ? [] : ['--fresh']
}
