import { stat } from 'node:fs/promises'
import path from 'node:path'

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
