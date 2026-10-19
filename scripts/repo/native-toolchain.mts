import { stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { ensureLlvmCoverageTools } from '../fleet/cover/llvm-toolchain.mts'
import type { LlvmCoverageTools } from '../fleet/cover/llvm-toolchain.mts'
import { REPO_ROOT } from './paths.mts'

export interface NativeCoverageToolchain extends LlvmCoverageTools {
  sdk: string
}

export async function ensureNativeCoverageToolchain(): Promise<NativeCoverageToolchain> {
  if (process.platform !== 'darwin') {
    throw new Error(
      'Sockeye native coverage requires the macOS SDK and pinned LLVM toolchain',
    )
  }
  const tools = await ensureLlvmCoverageTools(REPO_ROOT)
  const result = await spawn('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
    cwd: REPO_ROOT,
  })
  const sdk = result.stdout.trim()
  if (!path.isAbsolute(sdk) || !(await stat(sdk)).isDirectory()) {
    throw new Error(
      `macOS SDK resolution failed at xcrun: saw ${sdk || 'empty output'}, wanted an absolute SDK directory. Install the Xcode command-line tools.`,
    )
  }
  return { ...tools, sdk }
}
