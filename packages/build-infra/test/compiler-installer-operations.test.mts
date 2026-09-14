import { beforeEach, expect, test, vi } from 'vitest'
import { which } from '@socketsecurity/lib-stable/exe/path/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getPlatform } from '../lib/build-env.mts'
import { detectPackageManagers } from '../lib/tool-installer.mts'
import {
  canInstallGcc,
  checkGccVersion,
  compareVersions,
  ensureGccVersion,
  getGccInstructions,
  getGccVersion,
  installGccApt,
  parseVersion,
} from '../lib/compiler-installer.mts'
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  which: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/build-env.mts'), () => ({ getPlatform: vi.fn() }))
vi.mock(import('../lib/tool-installer.mts'), () => ({
  detectPackageManagers: vi.fn(),
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(which).mockResolvedValue('/example/sudo')
  vi.mocked(getPlatform).mockReturnValue('linux')
  vi.mocked(detectPackageManagers).mockReturnValue(['apt'])
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: 'gcc 12.2.0',
    stderr: '',
    pid: 0,
  })
})
test.each([
  ['12.2.0', '12.2.0', 0],
  ['11.9.9', '12.0.0', -1],
  ['13.0.0', '12.0.0', 1],
  ['12.1.9', '12.2.0', -1],
  ['12.3.0', '12.2.0', 1],
  ['12.2.0', '12.2.1', -1],
  ['12.2.2', '12.2.1', 1],
] as const)('compares %s with %s', (left, right, expected) => {
  expect(compareVersions(left, right)).toBe(expected)
})
test('rejects malformed versions and parses distribution suffixes', () => {
  expect(parseVersion('12.2.0-ubuntu1')).toEqual({
    major: 12,
    minor: 2,
    patch: 0,
  })
  expect(parseVersion('unknown')).toBeUndefined()
  expect(parseVersion(`${'1'.repeat(100_000)}.2.3`)).toBeUndefined()
  expect(compareVersions('unknown', '12.2.0')).toBeNaN()
  expect(compareVersions('12.2.0', 'unknown')).toBeNaN()
})
test.each(['linux', 'darwin', 'win32'])(
  'offers platform instructions and installation eligibility on %s',
  platform => {
    vi.mocked(getPlatform).mockReturnValue(platform)
    expect(getGccInstructions().join('\n')).toContain(
      platform === 'linux'
        ? 'apt-get'
        : platform === 'darwin'
          ? 'xcode-select'
          : 'your platform',
    )
    expect(canInstallGcc({ quiet: false })).toBe(platform === 'linux')
    vi.mocked(detectPackageManagers).mockReturnValue([])
    expect(canInstallGcc({ quiet: false })).toBe(false)
  },
)
test('checks installed versions and handles unavailable or unrecognized compiler output', async () => {
  expect(await checkGccVersion('example-gcc', '12.0.0')).toMatchObject({
    installed: true,
    meetsRequirements: true,
  })
  expect(await checkGccVersion('example-gcc', 'unknown')).toMatchObject({
    installed: true,
    meetsRequirements: false,
  })
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: '',
    stderr: '',
    pid: 0,
  })
  expect(await getGccVersion()).toBeUndefined()
  vi.mocked(spawn).mockRejectedValue(new Error('fixture compiler unavailable'))
  expect(await checkGccVersion('example-gcc', '12.0.0')).toEqual({
    installed: false,
    meetsRequirements: false,
    version: undefined,
  })
})
test('installs both compilers before registering matching alternatives', async () => {
  expect(await installGccApt('12')).toBe(true)
  expect(vi.mocked(spawn).mock.calls.map(call => call[1])).toEqual([
    ['apt-get', 'install', '-y', 'gcc-12', 'g++-12'],
    [
      'update-alternatives',
      '--install',
      '/usr/bin/gcc',
      'gcc',
      '/usr/bin/gcc-12',
      '100',
    ],
    [
      'update-alternatives',
      '--install',
      '/usr/bin/g++',
      'g++',
      '/usr/bin/g++-12',
      '100',
    ],
  ])
})
test.each([0, 1, 2])(
  'stops after failed compiler installation phase %s',
  async phase => {
    vi.mocked(spawn).mockImplementation(async () => {
      if (vi.mocked(spawn).mock.calls.length - 1 === phase) {
        throw Object.assign(new Error('fixture install failure'), { code: 1 })
      }
      return { code: 0, stdout: '', stderr: '', pid: 0 }
    })
    expect(await installGccApt('12')).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(phase + 1)
  },
)
test('refuses installation when sudo is absent', async () => {
  vi.mocked(which).mockResolvedValue(undefined)
  expect(await installGccApt('12')).toBe(false)
  expect(spawn).not.toHaveBeenCalled()
})
test.each([true, false])(
  'verifies compiler after installation, sufficient=%s',
  async sufficient => {
    vi.mocked(spawn).mockImplementation(async (command, args) => ({
      code: 0,
      stdout:
        command === 'gcc'
          ? vi.mocked(spawn).mock.calls.length === 1 || !sufficient
            ? 'gcc 11.2.0'
            : 'gcc 12.2.0'
          : '',
      stderr: '',
      pid: 0,
    }))
    expect(await ensureGccVersion()).toEqual({
      available: sufficient,
      installed: sufficient,
      version: sufficient ? '12.2.0' : '11.2.0',
    })
    expect(spawn).toHaveBeenCalledTimes(5)
  },
)
test('reports sufficient compiler without mutation and failed installation without verification', async () => {
  expect(await ensureGccVersion()).toMatchObject({
    available: true,
    installed: false,
  })
  vi.mocked(spawn)
    .mockReset()
    .mockResolvedValueOnce({
      code: 0,
      stdout: 'gcc 11.2.0',
      stderr: '',
      pid: 0,
    })
    .mockRejectedValue(new Error('fixture install failure'))
  expect(await ensureGccVersion()).toMatchObject({
    available: false,
    installed: false,
    version: '11.2.0',
  })
  expect(spawn).toHaveBeenCalledTimes(2)
})
