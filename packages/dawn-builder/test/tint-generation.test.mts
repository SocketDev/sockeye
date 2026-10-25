import { beforeEach, expect, test, vi } from 'vitest'

import { generateTintSources } from '../scripts/tint-generation.mts'
import {
  getTintGenerationPaths,
  UPSTREAM_DAWN_GIT,
  UPSTREAM_DAWN_MOVED_GIT,
} from '../scripts/paths.mts'

const io = vi.hoisted(() => ({
  exists: vi.fn(),
  rename: vi.fn(),
  spawn: vi.fn(),
  which: vi.fn(),
}))
vi.mock(import('node:fs'), async importOriginal => {
  const original = await importOriginal()
  io.exists.mockImplementation(original.existsSync)
  return {
    ...original,
    existsSync: io.exists,
    promises: { ...original.promises, rename: io.rename },
  }
})
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async importOriginal => ({ ...(await importOriginal()), which: io.which }),
)
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), async importOriginal => ({
  ...(await importOriginal()),
  safeMkdir: vi.fn(),
}))
vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({ ...(await importOriginal()), spawn: io.spawn }),
)

beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(true)
  io.rename.mockResolvedValue(undefined)
  io.which.mockResolvedValue('example-go')
  io.spawn.mockResolvedValue({ code: 0, stdout: '' })
})

test('restores the git pointer after successful generation', async () => {
  const paths = getTintGenerationPaths('example-cmake')
  await generateTintSources('example-cmake')
  expect(io.spawn).toHaveBeenCalledWith(
    paths.genBin,
    ['sources', paths.genOutDir],
    expect.objectContaining({ stdio: 'inherit' }),
  )
  expect(io.rename.mock.calls).toEqual([
    [UPSTREAM_DAWN_GIT, UPSTREAM_DAWN_MOVED_GIT],
    [UPSTREAM_DAWN_MOVED_GIT, UPSTREAM_DAWN_GIT],
  ])
})

test('restores the git pointer when the generator fails', async () => {
  io.spawn
    .mockResolvedValueOnce({ code: 0 })
    .mockResolvedValueOnce({ code: 0, stdout: '' })
    .mockResolvedValueOnce({ code: 1 })
  await expect(generateTintSources('example-cmake')).rejects.toThrow()
  expect(io.rename).toHaveBeenLastCalledWith(
    UPSTREAM_DAWN_MOVED_GIT,
    UPSTREAM_DAWN_GIT,
  )
})

test('rejects a missing generator output after restoration', async () => {
  const paths = getTintGenerationPaths('example-cmake')
  io.exists.mockImplementation(file => file !== paths.enumsCc)
  await expect(generateTintSources('example-cmake')).rejects.toThrow()
  expect(io.rename).toHaveBeenLastCalledWith(
    UPSTREAM_DAWN_MOVED_GIT,
    UPSTREAM_DAWN_GIT,
  )
})

test('does not rename an absent git pointer', async () => {
  io.exists.mockImplementation(file => file !== UPSTREAM_DAWN_GIT)
  await generateTintSources('example-cmake')
  expect(io.rename).not.toHaveBeenCalled()
})

test('stops before generation when Go is absent', async () => {
  io.which.mockResolvedValue(undefined)
  await expect(generateTintSources('example-cmake')).rejects.toThrow()
  expect(io.spawn).not.toHaveBeenCalled()
  expect(io.rename).not.toHaveBeenCalled()
})

test('stops before touching the git pointer when the generator build fails', async () => {
  io.spawn.mockResolvedValueOnce({ code: 1 })
  await expect(generateTintSources('example-cmake')).rejects.toThrow()
  expect(io.rename).not.toHaveBeenCalled()
})
