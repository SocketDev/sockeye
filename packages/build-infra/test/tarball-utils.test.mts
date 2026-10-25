import { beforeEach, expect, test, vi } from 'vitest'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { extractTarball } from '../lib/tarball-utils.mts'

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeMkdir: vi.fn(),
}))
vi.mock(import('../lib/which-required.mts'), () => ({
  whichRequired: async () => 'tar',
}))
vi.mock(import('../lib/platform-mappings.mts'), () => ({
  tarSupportsNoAbsoluteNames: async () => true,
  tarSupportsOverwrite: async () => true,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    pid: 0,
    stdout: 'example/file.mts\n',
    stderr: '',
  })
})

test('validates the archive before extracting with supported safeguards', async () => {
  expect(
    await extractTarball('example.tar.gz', 'output', { stripComponents: 1 }),
  ).toEqual(['example/file.mts'])
  expect(vi.mocked(spawn).mock.calls.map(call => call[1])).toEqual([
    ['-tzf', 'example.tar.gz'],
    [
      '-xzf',
      'example.tar.gz',
      '-C',
      'output',
      '--strip-components=1',
      '--no-absolute-names',
      '--overwrite',
    ],
  ])
})

test('stops extraction when tar cannot list the archive', async () => {
  vi.mocked(spawn).mockRejectedValueOnce(
    Object.assign(new Error('example listing failure'), {
      code: 2,
      stdout: '',
      stderr: 'example listing failure',
    }),
  )
  await expect(extractTarball('example.tar.gz', 'output')).rejects.toThrow()
  expect(spawn).toHaveBeenCalledTimes(1)
})

test('stops extraction when an archive entry escapes the output directory', async () => {
  vi.mocked(spawn).mockResolvedValueOnce({
    code: 0,
    pid: 0,
    stdout: '../outside.mts\n',
    stderr: '',
  })
  await expect(extractTarball('example.tar.gz', 'output')).rejects.toThrow()
  expect(spawn).toHaveBeenCalledTimes(1)
})

test('reports extraction failure after successful validation', async () => {
  vi.mocked(spawn).mockResolvedValueOnce({
    code: 0,
    pid: 0,
    stdout: 'example.mts\n',
    stderr: '',
  })
  vi.mocked(spawn).mockRejectedValueOnce(
    Object.assign(new Error('example extraction failure'), {
      code: 2,
      stdout: '',
      stderr: 'example extraction failure',
    }),
  )
  await expect(extractTarball('example.tar.gz', 'output')).rejects.toThrow()
  expect(spawn).toHaveBeenCalledTimes(2)
})
