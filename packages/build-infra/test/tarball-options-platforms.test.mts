import path from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'
import { extractTarball, validateTarballPaths } from '../lib/tarball-utils.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn(), mkdir: vi.fn() }))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), isWin32: () => true }),
)
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeMkdir: io.mkdir,
}))
vi.mock(import('../lib/which-required.mts'), () => ({
  whichRequired: async () => 'tar',
}))
vi.mock(import('../lib/platform-mappings.mts'), () => ({
  tarSupportsNoAbsoluteNames: async () => false,
  tarSupportsOverwrite: async () => false,
}))
vi.mock(import('node:path'), async original => ({
  ...(await original()),
  default: (await original()).win32,
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
})

test('explicit extraction options skip directory creation and listing on Windows', async () => {
  expect(
    await extractTarball('C:\\example\\archive.tar.gz', 'C:\\example\\output', {
      createDir: false,
      validate: false,
      overwrite: false,
    }),
  ).toEqual([])
  expect(io.mkdir).not.toHaveBeenCalled()
  expect(io.spawn).toHaveBeenCalledExactlyOnceWith(
    'tar',
    ['-xzf', 'C:/example/archive.tar.gz', '-C', 'C:/example/output'],
    { stdio: 'ignore' },
  )
})

test('empty Windows listings remain empty and use converted archive paths', async () => {
  expect(await validateTarballPaths('C:\\example\\archive.tar.gz')).toEqual([])
  expect(io.spawn).toHaveBeenCalledWith(
    'tar',
    ['-tzf', 'C:/example/archive.tar.gz'],
    { stdio: 'pipe' },
  )
})

test('Windows drive-qualified members are rejected before extraction', async () => {
  expect(path.isAbsolute('C:\\example\\escape')).toBe(true)
  io.spawn.mockResolvedValue({
    code: 0,
    stdout: 'C:\\example\\escape\n',
    stderr: '',
  })
  await expect(extractTarball('example.tar.gz', 'output')).rejects.toThrow()
  expect(io.spawn).toHaveBeenCalledOnce()
})
