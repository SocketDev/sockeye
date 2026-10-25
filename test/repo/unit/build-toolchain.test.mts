import process from 'node:process'
import { getBinaryPath } from '../../../scripts/repo/paths.mts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildSockeye } from '../../../scripts/repo/build.mts'
const io = vi.hoisted(() => ({
  ensure: vi.fn(),
  spawn: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  artifacts: new Set<string>(),
}))
vi.mock(import('../../../scripts/repo/native-toolchain.mts'), () => ({
  ensureNativeCoverageToolchain: io.ensure,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    mkdirSync: io.mkdir,
    existsSync: (file: Parameters<typeof actual.existsSync>[0]) =>
      (typeof file === 'string' && io.artifacts.has(file)) ||
      actual.existsSync(file),
  }
})
vi.mock(import('node:fs/promises'), async original => ({
  ...(await original()),
  readFile: io.read,
  stat: io.stat,
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.ensure.mockResolvedValue({
    clangxx: '/example/llvm/bin/clang++',
    sdk: '/example/MacOSX.sdk',
    version: '22.1.0',
  })
  io.spawn.mockResolvedValue({ code: 0 })
  io.read.mockResolvedValue('{"version":"0.0.0"}')
  io.stat.mockResolvedValue({ size: 42 })
  io.artifacts.clear()
  for (const mode of ['coverage', 'dev', 'prod']) {
    io.artifacts.add(getBinaryPath(mode, `${process.platform}-${process.arch}`))
  }
})
afterEach(() => vi.unstubAllEnvs())
test('coverage configures fresh matched CXX and Objective-C++ compilers before building', async () => {
  vi.stubEnv('BUILD_MODE', 'coverage')
  await buildSockeye()
  expect(io.ensure).toHaveBeenCalledOnce()
  expect(io.spawn.mock.calls[0]?.[0]).toBe('cmake')
  expect(io.spawn.mock.calls[0]?.[1]).toEqual(
    expect.arrayContaining([
      '--fresh',
      '-DCMAKE_CXX_COMPILER=/example/llvm/bin/clang++',
      '-DCMAKE_OBJCXX_COMPILER=/example/llvm/bin/clang++',
      '-DCMAKE_OSX_SYSROOT=/example/MacOSX.sdk',
      '-DFLEET_LLVM_COVERAGE_VERSION=22.1.0',
      '-DSOCKEYE_COVERAGE=ON',
    ]),
  )
  expect(io.spawn.mock.calls[1]?.[1][0]).toBe('--build')
})
test.each(['dev', 'prod'])(
  '%s keeps the existing compiler without acquiring LLVM',
  async mode => {
    vi.stubEnv('BUILD_MODE', mode)
    await buildSockeye()
    expect(io.ensure).not.toHaveBeenCalled()
    expect(io.spawn.mock.calls[0]?.[1]).not.toContain('--fresh')
    expect(io.spawn.mock.calls[0]?.[1]).toContain('-DSOCKEYE_COVERAGE=OFF')
  },
)
test('coverage toolchain failure prevents CMake or addon execution', async () => {
  vi.stubEnv('BUILD_MODE', 'coverage')
  const failure = new Error('fixture toolchain unavailable')
  io.ensure.mockRejectedValue(failure)
  await expect(buildSockeye()).rejects.toBe(failure)
  expect(io.spawn).not.toHaveBeenCalled()
  expect(io.mkdir).not.toHaveBeenCalled()
})
