import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  applyPatch,
  applyPatchDirectory,
  createPatchFromGit,
  revertPatch,
  testPatchApplication,
  validatePatch,
} from '../lib/patch-validator.mts'

const io = vi.hoisted(() => ({
  which: vi.fn(),
  spawn: vi.fn(),
  error: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  which: io.which,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: io.error }))
let root: string
beforeEach(async () => {
  vi.resetAllMocks()
  root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-patch-operations-'))
  io.which.mockImplementation(async (command: string) => `/example/${command}`)
  io.spawn.mockResolvedValue({ code: 0, stdout: 'example diff', stderr: '' })
})
afterEach(async () => {
  await safeDelete(root)
})

test.each([
  [applyPatch, []],
  [revertPatch, ['--reverse']],
])(
  'applies directional patch commands with absolute input paths',
  async (operation, extra) => {
    await operation('example.patch', root)
    expect(io.spawn.mock.calls[0]?.slice(0, 2)).toEqual([
      '/example/patch',
      ['-p1', '--batch', ...extra, '-i', path.resolve('example.patch')],
    ])
    expect(io.spawn.mock.calls[0]?.[2].cwd).toBe(root)
  },
)

test.each([applyPatch, revertPatch])(
  'refuses missing patch tools and rejects process failures',
  async operation => {
    io.which.mockResolvedValue(undefined)
    await expect(operation('example.patch', root)).rejects.toThrow()
    expect(io.spawn).not.toHaveBeenCalled()
    io.which.mockResolvedValue('/example/patch')
    const exitFailure = Object.assign(new Error('fixture process exit'), {
      code: 1,
    })
    io.spawn.mockRejectedValue(exitFailure)
    await expect(operation('example.patch', root)).rejects.toThrow()
    const unexpected = new Error('fixture invocation failure')
    io.spawn.mockRejectedValue(unexpected)
    await expect(operation('example.patch', root)).rejects.toBe(unexpected)
  },
)

test.each([validatePatch, testPatchApplication])(
  'dry-run probes handle unavailable tools and all process outcomes',
  async operation => {
    expect(await operation('example.patch', root)).toBe(true)
    expect(io.spawn.mock.calls[0]?.[1]).toContain('--dry-run')
    expect(io.spawn.mock.calls[0]?.[1].includes('--reverse')).toBe(
      operation === testPatchApplication,
    )
    io.spawn.mockRejectedValue(
      Object.assign(new Error('fixture patch conflict'), {
        code: 1,
        stdout: 'fixture conflict',
        stderr: 'fixture failed hunk',
      }),
    )
    expect(await operation('example.patch', root)).toBe(false)
    io.spawn.mockRejectedValue(
      Object.assign(new Error('fixture patch failure'), { code: 1 }),
    )
    expect(await operation('example.patch', root)).toBe(false)
    io.spawn.mockRejectedValue(
      Object.assign(new Error('fixture exit'), { code: 2 }),
    )
    expect(await operation('example.patch', root)).toBe(false)
    io.spawn.mockRejectedValue(new Error('fixture failure'))
    expect(await operation('example.patch', root)).toBe(false)
    io.which.mockResolvedValue(false)
    expect(await operation('example.patch', root)).toBe(false)
  },
)

test('skips empty directories and applies only sorted patch files after validation', async () => {
  await applyPatchDirectory(root, '/example/source')
  expect(io.spawn).not.toHaveBeenCalled()
  await writeFile(path.join(root, 'second.patch'), 'example second patch')
  await writeFile(path.join(root, 'first.patch'), 'example first patch')
  await writeFile(path.join(root, 'notes.txt'), 'example note')
  await mkdir(path.join(root, 'directory.patch'))
  await applyPatchDirectory(root, '/example/source')
  expect(io.spawn.mock.calls).toHaveLength(4)
  expect(
    io.spawn.mock.calls.slice(2).map(call => path.basename(call[1].at(-1))),
  ).toEqual(['first.patch', 'second.patch'])
  expect(
    io.spawn.mock.calls
      .slice(0, 2)
      .every(call => call[1].includes('--dry-run')),
  ).toBe(true)
  io.spawn.mockClear()
  await applyPatchDirectory(root, '/example/source', { validate: false })
  expect(io.spawn.mock.calls).toHaveLength(2)
  expect(
    io.spawn.mock.calls.every(call => !call[1].includes('--dry-run')),
  ).toBe(true)
})

test('never applies patches after validation rejects any input', async () => {
  await writeFile(path.join(root, 'example.patch'), 'example patch')
  io.spawn.mockRejectedValue(
    Object.assign(new Error('fixture patch failure'), { code: 1 }),
  )
  await expect(applyPatchDirectory(root, '/example/source')).rejects.toThrow()
  expect(io.spawn).toHaveBeenCalledTimes(1)
  expect(io.spawn.mock.calls[0]?.[1]).toContain('--dry-run')
})

test.each([false, true])(
  'writes only the requested Git diff, staged=%s',
  async staged => {
    const output = path.join(root, 'example.patch')
    await createPatchFromGit(root, output, { staged })
    expect(await readFile(output, 'utf8')).toBe('example diff')
    expect(io.spawn.mock.calls[0]?.[1]).toEqual(
      staged ? ['diff', '--cached'] : ['diff'],
    )
  },
)

test('refuses absent Git and empty diff output', async () => {
  const output = path.join(root, 'example.patch')
  io.which.mockResolvedValue(undefined)
  await expect(createPatchFromGit(root, output)).rejects.toThrow()
  expect(io.spawn).not.toHaveBeenCalled()
  io.which.mockResolvedValue('/example/git')
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  await expect(createPatchFromGit(root, output)).rejects.toThrow()
  io.spawn.mockResolvedValue({ code: 0, stdout: ' \n', stderr: '' })
  await expect(createPatchFromGit(root, output)).rejects.toThrow()
})
