import { beforeEach, expect, test, vi } from 'vitest'
import {
  checkPythonVersion,
  cleanupPlatformDisk,
  comparePythonVersions,
  freeDiskSpace,
} from '../lib/host-env-checks.mts'

const host = vi.hoisted(() => ({
  spawn: vi.fn(),
  isCI: vi.fn(),
  tasks: [{ desc: 'example package', path: '/example-package' }],
}))

vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: host.spawn,
  }),
)
vi.mock(import('@socketsecurity/lib-stable/env/ci'), async importOriginal => ({
  ...(await importOriginal()),
  isCI: host.isCI,
}))
vi.mock(import('../lib/ci-cleanup-paths.mts'), async importOriginal => ({
  ...(await importOriginal()),
  getCleanupPaths: () => host.tasks,
}))

beforeEach(() => {
  host.spawn.mockReset().mockResolvedValue({ code: 0, stdout: '' })
  host.isCI.mockReset().mockReturnValue(false)
})

test.each([
  { version: '3.12', minVersion: '3.12', sufficient: true },
  { version: '3.13', minVersion: '3.12', sufficient: true },
  { version: '4.0', minVersion: '3.12', sufficient: true },
  { version: '3.11', minVersion: '3.12', sufficient: false },
  { version: '2.99', minVersion: '3.12', sufficient: false },
  { version: '3', minVersion: '3.12', sufficient: undefined },
  { version: '3.12', minVersion: '3', sufficient: undefined },
  { version: '3.12.invalid', minVersion: '3.12', sufficient: undefined },
  { version: '3.12', minVersion: '3.invalid', sufficient: undefined },
  { version: '3.12.1', minVersion: '3.12.9', sufficient: true },
])(
  'compares Python $version against $minVersion',
  ({ version, minVersion, sufficient }) => {
    expect(comparePythonVersions({ version, minVersion })).toBe(sufficient)
  },
)

test('skips every cleanup command outside CI', async () => {
  await freeDiskSpace()
  expect(host.spawn).not.toHaveBeenCalled()
})

test.each([
  { platform: 'linux', command: 'sudo', args: ['apt-get', 'clean'] },
  { platform: 'darwin', command: 'brew', args: ['cleanup', '-s'] },
])(
  'removes platform paths before cleaning the $platform package cache',
  async ({ platform, command, args }) => {
    await cleanupPlatformDisk(platform)
    expect(host.spawn.mock.calls).toEqual([
      ['sudo', ['rm', '-rf', '/example-package'], { stdio: 'inherit' }],
      [command, args, { stdio: 'inherit' }],
    ])
  },
)

test('continues to package-cache cleanup after a removal failure', async () => {
  host.spawn.mockRejectedValueOnce(new Error('example removal failure'))
  await cleanupPlatformDisk('linux')
  expect(host.spawn).toHaveBeenCalledTimes(2)
})

test('tries the alternate Python command after malformed output', async () => {
  host.spawn.mockResolvedValueOnce({ code: 0, stdout: 'invalid' })
  host.spawn.mockResolvedValueOnce({ code: 0, stdout: '3.12' })
  expect(await checkPythonVersion('3.12')).toEqual({
    available: true,
    sufficient: true,
    version: '3.12',
  })
  expect(host.spawn).toHaveBeenCalledTimes(2)
})

test('returns a valid older Python version without probing another command', async () => {
  host.spawn.mockResolvedValueOnce({ code: 0, stdout: '3.11' })
  expect(await checkPythonVersion('3.12')).toEqual({
    available: true,
    sufficient: false,
    version: '3.11',
  })
  expect(host.spawn).toHaveBeenCalledTimes(1)
})

test('runs Docker cleanup in CI and tolerates an unavailable Docker command', async () => {
  host.isCI.mockReturnValue(true)
  host.spawn.mockImplementation(async (command: string) => {
    if (command === 'docker') {
      throw new Error('example unavailable command')
    }
    return { __proto__: null, code: 0, stdout: '' }
  })
  await expect(freeDiskSpace()).resolves.toBeUndefined()
  expect(host.spawn).toHaveBeenCalledWith(
    'docker',
    ['image', 'prune', '--all', '--force'],
    expect.objectContaining({ stdio: 'inherit' }),
  )
})
