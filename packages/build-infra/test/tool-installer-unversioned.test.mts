import { beforeEach, expect, test, vi } from 'vitest'
import { detectPackageManagers } from '../lib/tool-installer-config.mts'
import { installTool } from '../lib/tool-installer-impl.mts'

const io = vi.hoisted(() => ({ spawn: vi.fn(), whichSync: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  which: async () => '/example/sudo',
  whichSync: io.whichSync,
}))
vi.mock(import('../lib/build-env.mts'), () => ({ getPlatform: () => 'linux' }))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolConfig: () => ({ origin: 'system' }),
  getToolVersion: () => undefined,
}))
beforeEach(() => {
  vi.resetAllMocks()
})

test('returns no available package managers when every configured executable is absent', () => {
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- which returns null.
  io.whichSync.mockReturnValue(null)
  expect(detectPackageManagers()).toEqual([])
  expect(io.whichSync.mock.calls.map(call => call[0])).toEqual([
    'apt-get',
    'apk',
    'dnf',
    'yum',
  ])
})

test('a configured unversioned tool installs without inventing a version constraint', async () => {
  io.whichSync.mockReturnValue('/example/system-tool')
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '', pid: 0 })
  expect(await installTool('example-system-tool', 'apt')).toBe(true)
  expect(io.spawn).toHaveBeenCalledOnce()
  expect(io.spawn.mock.calls[0]?.[1]).toEqual([
    'apt-get',
    'install',
    '-y',
    'example-system-tool',
  ])
})
