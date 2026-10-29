import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ensureNativeCoverageToolchain } from '../../../scripts/repo/native-toolchain.mts'
const io = vi.hoisted(() => ({
  ensure: vi.fn(),
  resolveSdk: vi.fn(),
}))
vi.mock(import('../../../scripts/fleet/cover/llvm-toolchain.mts'), () => ({
  ensureLlvmCoverageTools: io.ensure,
}))
vi.mock(import('../../../scripts/repo/paths/macos-sdk.mts'), () => ({
  resolveMacosSdkPath: io.resolveSdk,
}))
const tools = {
  clang: '/example/llvm/bin/clang',
  clangxx: '/example/llvm/bin/clang++',
  llvmCov: '/example/llvm/bin/llvm-cov',
  llvmProfdata: '/example/llvm/bin/llvm-profdata',
  version: '22.1.0',
}
beforeEach(() => {
  vi.resetAllMocks()
  io.ensure.mockResolvedValue(tools)
  io.resolveSdk.mockResolvedValue('/example/MacOSX.sdk')
})
afterEach(() => vi.restoreAllMocks())
test('combines the verified LLVM installation with the resolved macOS SDK', async () => {
  expect(await ensureNativeCoverageToolchain()).toEqual({
    ...tools,
    sdk: '/example/MacOSX.sdk',
  })
  expect(io.resolveSdk).toHaveBeenCalledExactlyOnceWith()
})
test('propagates failed tool acquisition before invoking SDK discovery', async () => {
  const failure = new Error('fixture LLVM unavailable')
  io.ensure.mockRejectedValue(failure)
  await expect(ensureNativeCoverageToolchain()).rejects.toBe(failure)
  expect(io.resolveSdk).not.toHaveBeenCalled()
})
