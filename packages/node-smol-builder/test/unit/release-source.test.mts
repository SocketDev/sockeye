import { beforeEach, expect, test, vi } from 'vitest'
import {
  isNodeSourceDirty,
  resetReleaseSource,
  restoreReleaseSource,
  verifyReleaseSource,
} from '../../scripts/binary-released/shared/release-source.mts'

const io = vi.hoisted(() => ({
  exists: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  shouldRun: vi.fn(),
  which: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock(import('node:fs'), async importOriginal => {
  const original = await importOriginal()
  return {
    ...original,
    existsSync: filename =>
      String(filename).startsWith('/example/')
        ? io.exists(filename)
        : original.existsSync(filename),
    promises: { ...original.promises, readFile: io.read },
  }
})
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), async importOriginal => ({
  ...(await importOriginal()),
  safeDelete: io.remove,
}))
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async importOriginal => ({ ...(await importOriginal()), which: io.which }),
)
vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({ ...(await importOriginal()), spawn: io.spawn }),
)
vi.mock(
  import('local-build-infra/lib/checkpoint-manager'),
  async importOriginal => ({
    ...(await importOriginal()),
    restoreCheckpoint: io.restore,
    shouldRun: io.shouldRun,
  }),
)
vi.mock(
  import('../../scripts/source-patched/shared/apply-patches.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    computePatchChainCachePaths: () => ['/example/patch'],
  }),
)

const config = {
  autoYes: true,
  buildDir: '/example/build',
  buildMode: 'dev',
  buildPatchesDir: '/example/patches',
  cleanBuild: false,
  modeSourceDir: '/example/source',
  packageName: 'example-tool',
  sharedBuildDir: '/example/shared',
}

beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(true)
  io.shouldRun.mockResolvedValue(false)
  io.which.mockResolvedValue('/example/git')
  io.spawn.mockResolvedValue({ code: 0, stdout: '' })
  io.restore.mockResolvedValue(true)
})

test('does not reset a clean source tree', async () => {
  await resetReleaseSource(config)
  expect(io.remove).not.toHaveBeenCalled()
})

test('invalidates source and both stale patch checkpoint artifacts', async () => {
  io.shouldRun.mockResolvedValue(true)
  await resetReleaseSource(config)
  expect(io.remove.mock.calls.map(([filename]) => filename)).toEqual([
    '/example/source',
    '/example/build/checkpoints/source-patched.tar.gz',
    '/example/build/checkpoints/source-patched.json',
  ])
  expect(io.spawn).not.toHaveBeenCalled()
})

test('resets a dirty source only after the patch check allows reuse', async () => {
  io.spawn.mockResolvedValue({ code: 0, stdout: ' M example.cc\n' })
  await resetReleaseSource(config)
  expect(io.remove).toHaveBeenCalledExactlyOnceWith('/example/source')
})

test('treats a missing Git executable as no dirty-source signal', async () => {
  io.which.mockResolvedValue(undefined)
  await expect(isNodeSourceDirty('/example/source')).resolves.toBe(false)
  expect(io.spawn).not.toHaveBeenCalled()
})

test('does not restore an existing source tree', async () => {
  await restoreReleaseSource(config)
  expect(io.restore).not.toHaveBeenCalled()
})

test('dirty-source reset honors the five-second inspection window without --yes', async () => {
  vi.useFakeTimers()
  try {
    io.spawn.mockResolvedValue({ code: 0, stdout: ' M example.cc\n' })
    const resetting = resetReleaseSource({ ...config, autoYes: false })
    await vi.advanceTimersByTimeAsync(4999)
    expect(io.remove).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await resetting
    expect(io.remove).toHaveBeenCalledExactlyOnceWith('/example/source')
  } finally {
    vi.useRealTimers()
  }
})

test('falls back from patched to pristine source checkpoints', async () => {
  io.exists.mockReturnValue(false)
  io.restore.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await restoreReleaseSource(config)
  expect(io.restore.mock.calls.map(call => call.slice(0, 3))).toEqual([
    ['/example/build', 'example-tool', 'source-patched'],
    ['/example/shared', 'example-tool', 'source-copied'],
  ])
})

test('refuses extraction when neither source checkpoint restores', async () => {
  io.exists.mockReturnValue(false)
  io.restore.mockResolvedValue(false)
  await expect(restoreReleaseSource(config)).rejects.toThrow()
})

test('rejects corrupted V8 include paths', async () => {
  io.read
    .mockResolvedValueOnce('#include "base/iterator.h"')
    .mockResolvedValueOnce('')
  await expect(
    verifyReleaseSource({
      bootstrapFile: '/example/bootstrap.js',
      testFile: '/example/test.cc',
    }),
  ).rejects.toThrow()
})

test('accepts the Node-version-specific V8 include prefix', async () => {
  io.read
    .mockResolvedValueOnce('#include "src/base/iterator.h"')
    .mockResolvedValueOnce(
      "require('internal/socketsecurity/polyfills/locale-compare')",
    )
  await expect(
    verifyReleaseSource({
      bootstrapFile: '/example/bootstrap.js',
      testFile: '/example/test.cc',
    }),
  ).resolves.toBeUndefined()
})
