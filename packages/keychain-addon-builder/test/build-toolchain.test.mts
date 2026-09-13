import process from 'node:process'
import { getKeychainAddonBinaryPath } from '../scripts/paths.mts'
import { getNodeHeaderDirectory } from '../../../scripts/repo/paths.mts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  buildKeychainAddon,
  pkgConfig,
  resolvePlatformBuild,
} from '../scripts/build.mts'
const io = vi.hoisted(() => ({
  ensure: vi.fn(),
  spawn: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
  artifacts: new Set<string>(),
  missing: new Set<string>(),
}))
vi.mock(import('../../../scripts/repo/native-toolchain.mts'), () => ({
  ensureNativeCoverageToolchain: io.ensure,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawnSync: io.spawn,
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    existsSync: (file: Parameters<typeof actual.existsSync>[0]) =>
      typeof file === 'string' && io.missing.has(file)
        ? false
        : (typeof file === 'string' && io.artifacts.has(file)) ||
          actual.existsSync(file),
  }
})
vi.mock(import('node:fs/promises'), async original => ({
  ...(await original()),
  mkdir: io.mkdir,
  stat: io.stat,
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.ensure.mockResolvedValue({
    clangxx: '/example/llvm/bin/clang++',
    sdk: '/example/MacOSX.sdk',
    version: '22.1.0',
  })
  io.artifacts.clear()
  io.missing.clear()
  for (const mode of ['coverage', 'dev', 'prod']) {
    io.artifacts.add(
      getKeychainAddonBinaryPath(mode, `${process.platform}-${process.arch}`),
    )
  }
  io.spawn.mockReturnValue({ status: 0, stdout: '', stderr: '' })
  io.stat.mockResolvedValue({ size: 42 })
})
afterEach(() => vi.unstubAllEnvs())
test('coverage uses one pinned compiler and SDK for both objects and final linking', async () => {
  vi.stubEnv('BUILD_MODE', 'coverage')
  vi.stubEnv('SOCKEYE_COVERAGE_PROFILE_FILE', '/example/profiles/%m-%p.profraw')
  await buildKeychainAddon()
  expect(io.ensure).toHaveBeenCalledOnce()
  expect(io.spawn).toHaveBeenCalledTimes(3)
  for (const [command, args] of io.spawn.mock.calls) {
    expect(command).toBe('/example/llvm/bin/clang++')
    expect(args).toEqual(
      expect.arrayContaining([
        '-isysroot',
        '/example/MacOSX.sdk',
        '-fprofile-instr-generate=/example/profiles/%m-%p.profraw',
      ]),
    )
  }
  expect(io.spawn.mock.calls[0]?.[1]).toContain('-fcoverage-mapping')
  expect(io.spawn.mock.calls[1]?.[1]).toContain('-fobjc-arc')
  expect(io.spawn.mock.calls[2]?.[1]).toContain('-shared')
})
test.each(['dev', 'prod'])(
  '%s preserves the Apple compiler and skips acquisition',
  async mode => {
    vi.stubEnv('BUILD_MODE', mode)
    await buildKeychainAddon()
    expect(io.ensure).not.toHaveBeenCalled()
    expect(io.spawn).toHaveBeenCalledTimes(3)
    for (const [command] of io.spawn.mock.calls) {
      expect(command).toBe('/usr/bin/clang++')
    }
  },
)
test('toolchain failure prevents compilation and linking', async () => {
  vi.stubEnv('BUILD_MODE', 'coverage')
  const failure = new Error('fixture LLVM unavailable')
  io.ensure.mockRejectedValue(failure)
  await expect(buildKeychainAddon()).rejects.toBe(failure)
  expect(io.spawn).not.toHaveBeenCalled()
})
test('compiler failure aborts before linking', async () => {
  vi.stubEnv('BUILD_MODE', 'coverage')
  const failure = Object.assign(new Error('fixture compiler exit'), { code: 1 })
  io.spawn.mockImplementationOnce(() => {
    throw failure
  })
  await expect(buildKeychainAddon()).rejects.toBe(failure)
  expect(io.spawn).toHaveBeenCalledOnce()
})

test('platform resolution covers Linux, Windows, and unsupported hosts', () => {
  io.spawn.mockReturnValue({
    status: 0,
    stdout: ' -pthread  -lsecret-1 ',
    stderr: '',
  })
  const linux = resolvePlatformBuild('linux', 'prod')
  expect(linux.backendLang).toBe('c')
  expect(linux.compileFlags).toContain('-pthread')
  expect(linux.linkFlags).toEqual(['-Wl,-s', '-pthread', '-lsecret-1'])

  const windows = resolvePlatformBuild('win32', 'dev')
  expect(windows.backendLang).toBe('c')
  expect(windows.linkFlags.at(-2)).toBe('-ladvapi32')
  expect(windows.linkFlags.at(-1)).toMatch(/node\.lib$/u)
  expect(() => resolvePlatformBuild('aix', 'dev')).toThrow(
    "unsupported platform 'aix'",
  )
})

test('pkg-config rejects failed probes and removes empty output tokens', () => {
  io.spawn.mockReturnValueOnce({
    status: 0,
    stdout: '  -I/example  \n -pthread  ',
    stderr: '',
  })
  expect(pkgConfig(['--cflags', 'libsecret-1'])).toEqual([
    '-I/example',
    '-pthread',
  ])
  io.spawn.mockReturnValueOnce({
    status: 1,
    stdout: '',
    stderr: 'fixture missing package\n',
  })
  expect(() => pkgConfig(['--libs', 'libsecret-1'])).toThrow(
    'fixture missing package',
  )
})

test.each([
  ['linux', 'c++'],
  ['win32', 'clang++'],
] as const)(
  '%s builds the C backend with its host compiler',
  async (platform, compiler) => {
    vi.stubEnv('BUILD_MODE', 'dev')
    const platformArch = `${platform}-example-arch`
    io.artifacts.add(getKeychainAddonBinaryPath('dev', platformArch))
    await buildKeychainAddon(platform, 'example-arch')
    const compilerCalls = io.spawn.mock.calls.filter(
      ([command]) => command === compiler,
    )
    expect(compilerCalls).toHaveLength(3)
    expect(compilerCalls[1]?.[1]).toEqual(expect.arrayContaining(['-x', 'c']))
  },
)

test('build reports missing headers, failed commands, and missing output', async () => {
  const header = `${getNodeHeaderDirectory()}/node_api.h`
  io.missing.add(header)
  await expect(buildKeychainAddon()).rejects.toThrow('node_api.h not found')
  io.missing.delete(header)

  io.spawn.mockReturnValueOnce({
    status: 7,
    stdout: '',
    stderr: 'fixture compiler failure',
  })
  await expect(buildKeychainAddon()).rejects.toThrow(
    'exited 7: fixture compiler failure',
  )

  io.spawn.mockReturnValue({ status: 0, stdout: '', stderr: '' })
  io.missing.add(
    getKeychainAddonBinaryPath('dev', `${process.platform}-${process.arch}`),
  )
  await expect(buildKeychainAddon()).rejects.toThrow('Expected')
})
