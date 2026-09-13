import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ensureNativeCoverageToolchain } from '../../../scripts/repo/native-toolchain.mts'
const io = vi.hoisted(() => ({
  ensure: vi.fn(),
  spawn: vi.fn(),
  stat: vi.fn(),
}))
vi.mock(import('../../../scripts/fleet/cover/llvm-toolchain.mts'), () => ({
  ensureLlvmCoverageTools: io.ensure,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('node:fs/promises'), async original => ({
  ...(await original()),
  stat: io.stat,
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
  io.spawn.mockResolvedValue({ code: 0, stdout: '/example/MacOSX.sdk\n' })
  io.stat.mockResolvedValue({ isDirectory: () => true })
})
afterEach(() => vi.restoreAllMocks())
test('combines the verified LLVM installation with the resolved macOS SDK', async () => {
  expect(await ensureNativeCoverageToolchain()).toEqual({
    ...tools,
    sdk: '/example/MacOSX.sdk',
  })
  expect(io.spawn).toHaveBeenCalledWith(
    'xcrun',
    ['--sdk', 'macosx', '--show-sdk-path'],
    expect.any(Object),
  )
  expect(io.stat).toHaveBeenCalledExactlyOnceWith('/example/MacOSX.sdk')
})
test.each(['', 'relative-sdk'])('rejects invalid SDK output %j', async sdk => {
  io.spawn.mockResolvedValue({ code: 0, stdout: sdk })
  await expect(ensureNativeCoverageToolchain()).rejects.toThrow()
  expect(io.stat).not.toHaveBeenCalled()
})
test('rejects a non-directory SDK', async () => {
  io.stat.mockResolvedValue({ isDirectory: () => false })
  await expect(ensureNativeCoverageToolchain()).rejects.toThrow()
})
test('propagates failed tool acquisition before invoking SDK discovery', async () => {
  const failure = new Error('fixture LLVM unavailable')
  io.ensure.mockRejectedValue(failure)
  await expect(ensureNativeCoverageToolchain()).rejects.toBe(failure)
  expect(io.spawn).not.toHaveBeenCalled()
})
test('propagates SDK command launch failures without a fallback compiler', async () => {
  const failure = Object.assign(new Error('fixture xcrun missing'), {
    code: 'ENOENT',
  })
  io.spawn.mockRejectedValue(failure)
  await expect(ensureNativeCoverageToolchain()).rejects.toBe(failure)
})
