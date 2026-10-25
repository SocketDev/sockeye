import { beforeEach, expect, test, vi } from 'vitest'
import { runBinject, SMOL_VFS_BLOB } from '../helpers/binject.mts'

const io = vi.hoisted(() => ({ mkdir: vi.fn(), spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), async importOriginal => ({
  ...(await importOriginal()),
  safeMkdir: io.mkdir,
}))
vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: io.spawn,
  }),
)

beforeEach(() => {
  vi.clearAllMocks()
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
})

for (const [vfsMode, flag] of [
  ['on-disk', '--vfs-on-disk'],
  ['in-memory', '--vfs-in-memory'],
  ['compat', '--vfs-compat'],
]) {
  for (const dual of [false, true]) {
    test(`injects ${dual ? 'dual' : 'single'} VFS in ${vfsMode} mode`, async () => {
      await runBinject(
        'application',
        dual ? 'BOTH' : SMOL_VFS_BLOB,
        dual ? { sea: 'application.blob', vfs: 'files.tar' } : 'files.tar',
        { testDir: '/example/test', vfsMode },
      )
      const resourceArgs =
        vfsMode === 'compat' ? [flag] : [flag, '/example/test/files.tar']
      expect(io.spawn.mock.calls[0]?.[1]).toEqual([
        'inject',
        '-e',
        '/example/test/application',
        '-o',
        '/example/test/application',
        ...(dual ? ['--sea', '/example/test/application.blob'] : []),
        ...resourceArgs,
      ])
    })
  }
}

test('preserves absolute SEA and executable paths', async () => {
  await runBinject(
    '/example/application',
    'NODE_SEA_BLOB',
    '/example/application.blob',
    { testDir: '/example/test' },
  )
  expect(io.spawn.mock.calls[0]?.[1]).toEqual([
    'inject',
    '-e',
    '/example/application',
    '-o',
    '/example/application',
    '--sea',
    '/example/application.blob',
  ])
})

test('rejects unknown resources before any filesystem or subprocess action', async () => {
  await expect(
    runBinject('application', 'UNKNOWN', 'file.blob', {
      testDir: '/example/test',
    }),
  ).rejects.toThrow()
  expect(io.mkdir).not.toHaveBeenCalled()
  expect(io.spawn).not.toHaveBeenCalled()
})
