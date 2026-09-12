import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  closeSync,
  existsSync,
  openSync,
  promises as fs,
  readSync,
  renameSync,
} from 'node:fs'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { withLock } from '../../lib/checkpoint-lock.mts'
import { computeSourceHash } from '../../lib/extraction-cache.mts'
import { extractTarball } from '../../lib/tarball-utils.mts'
import {
  createCheckpointArchive,
  runCheckpointTar,
  validateCheckpointDirectory,
  validateCreatedCheckpointArchive,
} from '../../lib/checkpoint/archive.mts'
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  readSync: vi.fn(),
  renameSync: vi.fn(),
  promises: { ...(await original()).promises, stat: vi.fn(), readdir: vi.fn() },
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDeleteSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../../lib/checkpoint-lock.mts'), () => ({ withLock: vi.fn() }))
vi.mock(import('../../lib/extraction-cache.mts'), () => ({
  computeSourceHash: vi.fn(),
}))
vi.mock(import('../../lib/tarball-utils.mts'), () => ({
  extractTarball: vi.fn(),
}))
vi.mock(import('../../lib/which-required.mts'), () => ({
  whichRequired: vi.fn().mockResolvedValue('/example/bin/tar'),
}))
const config = {
  artifactPath: 'output.node',
  packageRoot: undefined,
  tarExcludes: undefined,
}
function archiveStats(size = 30, directory = false) {
  return { size, isDirectory: () => directory } as Awaited<
    ReturnType<typeof fs.stat>
  >
}
function createArchive() {
  return createCheckpointArchive(
    '/example/build',
    'compiled',
    '/example/build/checkpoints/compiled.json',
    config,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(openSync).mockReturnValue(42)
  vi.mocked(readSync).mockImplementation((...args) => {
    const buffer = args[1]
    if (Buffer.isBuffer(buffer)) {
      buffer[0] = 0x1f
      buffer[1] = 0x8b
    }
    return 2
  })
  vi.mocked(fs.stat).mockResolvedValue(archiveStats())
  vi.mocked(fs.readdir).mockResolvedValue([])
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: 'output.node\n',
    stderr: '',
  })
  vi.mocked(withLock).mockImplementation(async (...args) => args[2]())
  vi.mocked(computeSourceHash).mockReturnValue('example-artifact-hash')
})
afterEach(() => vi.useRealTimers())
test('rejects empty source directories', async () => {
  await expect(validateCheckpointDirectory('/example/source')).rejects.toThrow()
})
test.each(['EACCES', 'EPERM', 'ENOENT'])(
  'rejects inaccessible source directory %s',
  async code => {
    vi.mocked(fs.readdir).mockRejectedValue(
      Object.assign(new Error('example read failure'), { code }),
    )
    await expect(
      validateCheckpointDirectory('/example/source'),
    ).rejects.toThrow()
  },
)
test.each([0, 2 * 1024 * 1024 * 1024 + 1])(
  'deletes invalid created archive of size %s',
  async size => {
    vi.mocked(fs.stat).mockResolvedValue(archiveStats(size))
    await expect(
      validateCreatedCheckpointArchive('/example/archive', '/example/tar', {
        resolvedArtifactPath: '/example/output.node',
        tarBase: 'output.node',
      }),
    ).rejects.toThrow()
    expect(safeDeleteSync).toHaveBeenCalledWith('/example/archive')
    expect(openSync).not.toHaveBeenCalled()
  },
)
test.each([0, 1])(
  'rejects invalid gzip byte %s while closing descriptor',
  async position => {
    vi.mocked(readSync).mockImplementation((...args) => {
      const buffer = args[1]
      if (Buffer.isBuffer(buffer)) {
        buffer[0] = 0x1f
        buffer[1] = 0x8b
        buffer[position] = 0
      }
      return 2
    })
    await expect(
      validateCreatedCheckpointArchive('/example/archive', '/example/tar', {
        resolvedArtifactPath: '/example/output.node',
        tarBase: 'output.node',
      }),
    ).rejects.toThrow()
    expect(closeSync).toHaveBeenCalledWith(42)
  },
)
test.each([
  { code: 0, stdout: '' },
  { code: 0, stdout: 'other.node' },
])('rejects corrupted archive listing %j', async result => {
  vi.mocked(spawn).mockResolvedValue({ ...result, stderr: '' })
  await expect(
    validateCreatedCheckpointArchive('/example/archive', '/example/tar', {
      resolvedArtifactPath: '/example/output.node',
      tarBase: 'output.node',
    }),
  ).rejects.toThrow()
})
test('rejects failed archive listing even when output names the artifact', async () => {
  const failure = Object.assign(new Error('fixture tar listing failure'), {
    code: 1,
    stdout: 'output.node',
    stderr: '',
  })
  vi.mocked(spawn).mockRejectedValue(failure)
  await expect(
    validateCreatedCheckpointArchive('/example/archive', '/example/tar', {
      resolvedArtifactPath: '/example/output.node',
      tarBase: 'output.node',
    }),
  ).rejects.toBe(failure)
})
test('propagates tar command failures', async () => {
  const failure = new Error('example tar failed')
  vi.mocked(spawn).mockRejectedValue(failure)
  await expect(
    runCheckpointTar('/example/tar', ['-czf', '/example/archive']),
  ).rejects.toBe(failure)
})
test('publishes validated archive under lock and hashes extracted bytes', async () => {
  expect(await createArchive()).toEqual({
    checkpointAlreadyExists: false,
    artifactHash: 'example-artifact-hash',
  })
  expect(withLock).toHaveBeenCalledWith(
    '/example/build/checkpoints/compiled.tar.gz.lock',
    'ex',
    expect.any(Function),
  )
  expect(extractTarball).toHaveBeenCalledWith(
    '/example/build/checkpoints/compiled.tar.gz',
    expect.stringContaining('.extract.tmp.'),
  )
  expect(safeDeleteSync).toHaveBeenCalledWith(
    expect.stringContaining('.extract.tmp.'),
    { recursive: true },
  )
})
test.each(['EEXIST', 'EPERM'])(
  'preserves a valid concurrent archive on %s',
  async code => {
    vi.mocked(renameSync).mockImplementation(() => {
      throw Object.assign(new Error('example concurrent archive'), { code })
    })
    expect(await createArchive()).toEqual({
      checkpointAlreadyExists: true,
      artifactHash: undefined,
    })
    expect(extractTarball).not.toHaveBeenCalled()
    expect(safeDeleteSync).toHaveBeenCalledWith(
      expect.stringContaining('.tar.gz.tmp.'),
    )
  },
)
test('retries publication when the competing archive is empty', async () => {
  vi.useFakeTimers()
  vi.mocked(fs.stat)
    .mockResolvedValueOnce(archiveStats())
    .mockResolvedValueOnce(archiveStats())
    .mockResolvedValueOnce(archiveStats(0))
  vi.mocked(renameSync).mockImplementationOnce(() => {
    throw Object.assign(new Error('example concurrent archive'), {
      code: 'EEXIST',
    })
  })
  const result = createArchive()
  await vi.runAllTimersAsync()
  expect(await result).toEqual({
    checkpointAlreadyExists: false,
    artifactHash: 'example-artifact-hash',
  })
  expect(renameSync).toHaveBeenCalledTimes(2)
})
test('discards the temporary archive if competing archive cannot be inspected', async () => {
  vi.mocked(renameSync).mockImplementation(() => {
    throw Object.assign(new Error('example concurrent archive'), {
      code: 'EEXIST',
    })
  })
  vi.mocked(fs.stat)
    .mockResolvedValueOnce(archiveStats())
    .mockResolvedValueOnce(archiveStats())
    .mockRejectedValueOnce(new Error('example inspection failure'))
  expect(await createArchive()).toEqual({
    checkpointAlreadyExists: true,
    artifactHash: undefined,
  })
})
test.each(['ENOENT', 'EIO'])(
  'propagates publication failure %s and cleans temporary output',
  async code => {
    vi.mocked(renameSync).mockImplementation(() => {
      throw Object.assign(new Error('example publication failure'), { code })
    })
    await expect(createArchive()).rejects.toThrow()
    expect(safeDeleteSync).toHaveBeenCalledWith(
      expect.stringContaining('.tar.gz.tmp.'),
    )
    expect(extractTarball).not.toHaveBeenCalled()
  },
)
test('does not delete already absent temporary paths after failure', async () => {
  vi.mocked(existsSync).mockReturnValue(false)
  vi.mocked(spawn).mockRejectedValue(new Error('example tar failure'))
  await expect(createArchive()).rejects.toThrow()
  expect(safeDeleteSync).not.toHaveBeenCalled()
})
test('cleans extracted scratch even when hashing fails', async () => {
  const failure = new Error('example hashing failure')
  vi.mocked(computeSourceHash).mockImplementation(() => {
    throw failure
  })
  await expect(createArchive()).rejects.toBe(failure)
  expect(safeDeleteSync).toHaveBeenCalledWith(
    expect.stringContaining('.extract.tmp.'),
    { recursive: true },
  )
})
