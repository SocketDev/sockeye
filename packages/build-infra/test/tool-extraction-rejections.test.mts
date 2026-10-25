import { beforeEach, expect, test, vi } from 'vitest'
import { extractArchive } from '../lib/tool-downloader.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn(), mkdir: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return { ...actual, promises: { ...actual.promises, mkdir: io.mkdir } }
})
beforeEach(() => vi.resetAllMocks())
test.each(['zip', 'tar.xz'])(
  '%s extraction command failures propagate without pretending success',
  async format => {
    const failure = Object.assign(new Error('example extraction failed'), {
      code: 1,
    })
    io.spawn.mockRejectedValue(failure)
    await expect(
      extractArchive(`/example/archive.${format}`, '/example/output', format),
    ).rejects.toBe(failure)
    expect(io.mkdir).toHaveBeenCalledWith('/example/output', {
      recursive: true,
    })
    expect(io.spawn).toHaveBeenCalledOnce()
  },
)
test('destination creation failure prevents launching extraction', async () => {
  const failure = new Error('example destination denied')
  io.mkdir.mockRejectedValue(failure)
  await expect(
    extractArchive('/example/archive.zip', '/example/output', 'zip'),
  ).rejects.toBe(failure)
  expect(io.spawn).not.toHaveBeenCalled()
})
