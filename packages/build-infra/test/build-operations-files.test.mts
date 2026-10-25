import { statSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getFileSize, makeExecutable } from '../lib/build-operations.mts'
const io = vi.hoisted(() => ({
  stat: vi.fn(),
  chmod: vi.fn(),
  open: vi.fn(),
  sync: vi.fn(),
  close: vi.fn(),
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: io.stat,
      chmod: io.chmod,
      open: io.open,
    },
  }
})
beforeEach(() => {
  vi.resetAllMocks()
  io.open.mockResolvedValue({ sync: io.sync, close: io.close })
})
afterEach(() => vi.restoreAllMocks())
test.each([
  [0, '0 B'],
  [1023, '1023 B'],
  [1024, '1.00 KB'],
  [1_048_576, '1.00 MB'],
  [1_073_741_824, '1.00 GB'],
])('formats %s bytes across size units', async (size, expected) => {
  const stats = statSync(new URL(import.meta.url))
  stats.size = size
  io.stat.mockResolvedValue(stats)
  expect(await getFileSize('/example/binary')).toBe(expected)
})
test('stat failures remain visible to callers', async () => {
  const failure = new Error('example missing binary')
  io.stat.mockRejectedValue(failure)
  await expect(getFileSize('/example/binary')).rejects.toBe(failure)
})
test('executable mode is set before opening and syncing the binary', async () => {
  await makeExecutable('/example/binary')
  expect(io.chmod).toHaveBeenCalledWith('/example/binary', 0o755)
  expect(io.open).toHaveBeenCalledWith('/example/binary', 'r')
  expect(io.sync).toHaveBeenCalledOnce()
  expect(io.close).toHaveBeenCalledOnce()
  expect(io.chmod.mock.invocationCallOrder[0]).toBeLessThan(
    io.open.mock.invocationCallOrder[0]!,
  )
})
test('sync failure still closes the handle while open failure has no handle to close', async () => {
  io.sync.mockRejectedValue(new Error('example unsupported sync'))
  await expect(makeExecutable('/example/binary')).resolves.toBeUndefined()
  expect(io.close).toHaveBeenCalledOnce()
  io.open.mockRejectedValue(new Error('example open denied'))
  await expect(makeExecutable('/example/binary')).resolves.toBeUndefined()
  expect(io.close).toHaveBeenCalledOnce()
})
test('chmod rejection stops before open', async () => {
  const failure = new Error('example chmod denied')
  io.chmod.mockRejectedValue(failure)
  await expect(makeExecutable('/example/binary')).rejects.toBe(failure)
  expect(io.open).not.toHaveBeenCalled()
})
