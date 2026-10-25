import { beforeEach, expect, test, vi } from 'vitest'
import { existsSync, promises as fs, renameSync } from 'node:fs'
import { safeDeleteSync, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { restoreCheckpointData } from '../lib/checkpoint/restore.mts'
import { computeBinaryCheckpointHash } from '../lib/checkpoint/cache-validation.mts'
import {
  computeSourceHash,
  generateHashComment,
  shouldExtract,
} from '../lib/extraction-cache.mts'
import {
  getCacheHash,
  getCheckpointData,
  needsCacheRebuild,
  restoreCheckpoint,
  shouldRun,
  writeCacheHash,
} from '../lib/checkpoint-manager.mts'
import { PLATFORM_AGNOSTIC_CHECKPOINTS } from '../lib/constants.mts'
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: vi.fn(),
  renameSync: vi.fn(),
  promises: {
    ...(await original()).promises,
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(),
  safeDeleteSync: vi.fn(),
  safeMkdir: vi.fn(),
}))
vi.mock(import('../lib/checkpoint/restore.mts'), () => ({
  restoreCheckpointData: vi.fn(),
}))
vi.mock(import('../lib/checkpoint/cache-validation.mts'), () => ({
  computeBinaryCheckpointHash: vi.fn(),
}))
vi.mock(import('../lib/extraction-cache.mts'), () => ({
  computeSourceHash: vi.fn(),
  generateHashComment: vi.fn(),
  shouldExtract: vi.fn(),
}))
const source = [...PLATFORM_AGNOSTIC_CHECKPOINTS][0]!
const sourcePaths = ['/example/source.cc']
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(fs.readFile).mockResolvedValue('{"cacheHash":"example-hash"}')
  vi.mocked(computeSourceHash).mockReturnValue('example-hash')
  vi.mocked(computeBinaryCheckpointHash).mockReturnValue('example-hash')
  vi.mocked(generateHashComment).mockReturnValue('example hash comment')
})
test.each(['null', '17', '"invalid metadata"', '{invalid'])(
  'rejects malformed checkpoint data %s',
  content => {
    vi.mocked(fs.readFile).mockResolvedValue(content)
    return expect(
      getCheckpointData('/example/build', 'example-package', source),
    ).rejects.toThrow()
  },
)
test('propagates unreadable checkpoint errors', async () => {
  const failure = Object.assign(new Error('example denied read'), {
    code: 'EACCES',
  })
  vi.mocked(fs.readFile).mockRejectedValue(failure)
  await expect(
    getCheckpointData('/example/build', 'example-package', source),
  ).rejects.toBe(failure)
})
test('missing checkpoints cannot be restored', async () => {
  vi.mocked(fs.readFile).mockRejectedValue(
    Object.assign(new Error('example missing checkpoint'), { code: 'ENOENT' }),
  )
  expect(
    await restoreCheckpoint('/example/build', 'example-package', source),
  ).toBe(false)
  expect(restoreCheckpointData).not.toHaveBeenCalled()
})
test('forwards restore options and validation outcome', async () => {
  vi.mocked(restoreCheckpointData).mockResolvedValue(false)
  const options = {
    destDir: '/example/target',
    platform: 'darwin',
    arch: 'arm64',
  }
  expect(
    await restoreCheckpoint(
      '/example/build',
      'example-package',
      source,
      options,
    ),
  ).toBe(false)
  expect(restoreCheckpointData).toHaveBeenCalledWith(
    '/example/build',
    'example-package',
    source,
    { cacheHash: 'example-hash' },
    options,
  )
})
test.each([{}, { force: false, sourcePaths: [] }])(
  'reuses a checkpoint without requested source validation %j',
  async options => {
    expect(
      await shouldRun('/example/build', 'example-package', source, options),
    ).toBe(false)
    expect(fs.readFile).not.toHaveBeenCalled()
  },
)
test.each(['{}', 'missing'])(
  'rebuilds when source validation metadata is unavailable %s',
  async content => {
    if (content === 'missing') {
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error('example missing checkpoint'), {
          code: 'ENOENT',
        }),
      )
    } else {
      vi.mocked(fs.readFile).mockResolvedValue(content)
    }
    expect(
      await shouldRun('/example/build', 'example-package', source, {
        sourcePaths,
      }),
    ).toBe(true)
    expect(computeSourceHash).not.toHaveBeenCalled()
  },
)
test.each([source, 'compiled'])(
  'uses the correct source or binary identity for %s',
  async name => {
    const options = { sourcePaths, platform: 'darwin', arch: 'arm64' }
    expect(
      await shouldRun('/example/build', 'example-package', name, options),
    ).toBe(false)
    if (name === source) {
      expect(computeSourceHash).toHaveBeenCalledWith(sourcePaths)
      expect(computeBinaryCheckpointHash).not.toHaveBeenCalled()
    } else {
      expect(computeBinaryCheckpointHash).toHaveBeenCalledWith(
        name,
        sourcePaths,
        options,
      )
      expect(computeSourceHash).not.toHaveBeenCalled()
    }
    vi.mocked(fs.readFile).mockResolvedValue('{"cacheHash":"changed-hash"}')
    expect(
      await shouldRun('/example/build', 'example-package', name, options),
    ).toBe(true)
  },
)
test('delegates hash computation and existing cache validation', async () => {
  expect(getCacheHash(sourcePaths)).toBe('example-hash')
  vi.mocked(shouldExtract).mockResolvedValue(true)
  expect(await needsCacheRebuild('/example/cache', sourcePaths)).toBe(true)
  expect(shouldExtract).toHaveBeenCalledWith({
    outputPath: '/example/cache/cache-validation.hash',
    sourcePaths,
  })
})
test('publishes a generated hash atomically', async () => {
  await writeCacheHash('/example/cache', sourcePaths)
  expect(safeMkdir).toHaveBeenCalledWith('/example/cache')
  expect(fs.writeFile).toHaveBeenCalledWith(
    expect.stringContaining('/cache-validation.hash.tmp.'),
    'example hash comment',
    'utf8',
  )
  expect(renameSync).toHaveBeenCalledWith(
    expect.any(String),
    '/example/cache/cache-validation.hash',
  )
})
test.each(['EEXIST', 'EPERM', 'EIO'])(
  'handles atomic hash publication failure %s',
  async code => {
    const failure = Object.assign(new Error('example rename failure'), { code })
    vi.mocked(renameSync).mockImplementation(() => {
      throw failure
    })
    const result = writeCacheHash('/example/cache', sourcePaths)
    if (code === 'EIO') {
      await expect(result).rejects.toBe(failure)
      expect(safeDeleteSync).not.toHaveBeenCalled()
    } else {
      await result
      expect(safeDeleteSync).toHaveBeenCalledWith(
        expect.stringContaining('.hash.tmp.'),
      )
    }
  },
)
