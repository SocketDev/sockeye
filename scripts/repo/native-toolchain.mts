import process from 'node:process'
import { ensureLlvmCoverageTools } from '../fleet/cover/llvm-toolchain.mts'
import type { LlvmCoverageTools } from '../fleet/cover/llvm-toolchain.mts'
import { REPO_ROOT } from './paths.mts'
import { resolveMacosSdkPath } from './paths/macos-sdk.mts'

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
  const sdk = await resolveMacosSdkPath()
  return { ...tools, sdk }
}
