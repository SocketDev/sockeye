import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { existsSync, promises as fs, statSync } from 'node:fs'
import { isCI } from '@socketsecurity/lib-stable/env/ci'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { withTryLock } from '../../lib/checkpoint-lock.mts'
import { cleanupPreviousCheckpoint } from '../../lib/checkpoint/cleanup.mts'

vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: vi.fn(),
  promises: { ...(await original()).promises, stat: vi.fn() },
}))
vi.mock(import('@socketsecurity/lib-stable/env/ci'), () => ({ isCI: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(),
}))
vi.mock(import('../../lib/checkpoint-lock.mts'), () => ({
  withTryLock: vi.fn(),
}))
afterEach(() => vi.restoreAllMocks())
const config = {
  artifactPath: 'example.node',
  checkpointChain: ['current', 'previous'],
}
function checkpointStats(size: number, mtimeMs: number) {
  const metadata = statSync(new URL(import.meta.url))
  metadata.size = size
  metadata.mtimeMs = mtimeMs
  metadata.mtime = new Date(mtimeMs)
  return metadata
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(isCI).mockReturnValue(true)
  vi.mocked(existsSync).mockReturnValue(true)
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  vi.mocked(fs.stat).mockResolvedValue(checkpointStats(30, 0))
  vi.mocked(withTryLock).mockImplementation(async (...args) => args[1](true))
})
test.each([
  { artifactPath: undefined, checkpointChain: ['current', 'previous'] },
  { artifactPath: 'example.node', checkpointChain: undefined },
  { artifactPath: 'example.node', checkpointChain: ['other'] },
  { artifactPath: 'example.node', checkpointChain: ['current'] },
  { artifactPath: 'example.node', checkpointChain: ['current', ''] },
])('does not remove unrelated checkpoints %j', async options => {
  await cleanupPreviousCheckpoint('/example/checkpoints', 'current', options)
  expect(safeDelete).not.toHaveBeenCalled()
})
test('keeps developer checkpoints outside CI', async () => {
  vi.mocked(isCI).mockReturnValue(false)
  await cleanupPreviousCheckpoint('/example/checkpoints', 'current', config)
  expect(safeDelete).not.toHaveBeenCalled()
})
test('removes an old archive and its metadata under the lock', async () => {
  await cleanupPreviousCheckpoint('/example/checkpoints', 'current', config)
  expect(safeDelete).toHaveBeenNthCalledWith(
    1,
    '/example/checkpoints/previous.tar.gz',
  )
  expect(safeDelete).toHaveBeenNthCalledWith(
    2,
    '/example/checkpoints/previous.json',
  )
})
test.each([0, 17])(
  'removes invalid archive size %s even when recent',
  async size => {
    vi.mocked(fs.stat).mockResolvedValue(checkpointStats(size, 1_000_000))
    vi.mocked(existsSync).mockImplementation(file =>
      String(file).endsWith('.tar.gz'),
    )
    await cleanupPreviousCheckpoint('/example/checkpoints', 'current', config)
    expect(safeDelete).toHaveBeenCalledTimes(1)
  },
)
test.each([1_000_000, 1_100_000])(
  'preserves recent or future-dated valid archive %s',
  async mtimeMs => {
    vi.mocked(fs.stat).mockResolvedValue(checkpointStats(30, mtimeMs))
    await cleanupPreviousCheckpoint('/example/checkpoints', 'current', config)
    expect(withTryLock).not.toHaveBeenCalled()
  },
)
test('ignores absent archives', async () => {
  vi.mocked(existsSync).mockReturnValue(false)
  await cleanupPreviousCheckpoint('/example/checkpoints', 'current', config)
  expect(fs.stat).not.toHaveBeenCalled()
})
test.each([false, undefined])(
  'keeps a checkpoint when lock result is %s',
  async result => {
    vi.mocked(withTryLock).mockImplementation(async (...args) =>
      result === false ? args[1](false) : undefined,
    )
    await cleanupPreviousCheckpoint('/example/checkpoints', 'current', config)
    expect(safeDelete).not.toHaveBeenCalled()
  },
)
test('cleanup failure does not invalidate the newly created checkpoint', async () => {
  vi.mocked(fs.stat).mockRejectedValue(
    new Error('example inaccessible checkpoint'),
  )
  await expect(
    cleanupPreviousCheckpoint('/example/checkpoints', 'current', config),
  ).resolves.toBeUndefined()
  expect(safeDelete).not.toHaveBeenCalled()
})
