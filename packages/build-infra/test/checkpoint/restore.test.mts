import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  closeSync,
  openSync,
  promises as fs,
  readSync,
  statSync,
} from 'node:fs'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { withLock } from '../../lib/checkpoint-lock.mts'
import { computeSourceHash } from '../../lib/extraction-cache.mts'
import { extractTarball } from '../../lib/tarball-utils.mts'
import {
  extractCheckpointWithRetry,
  extractLockedCheckpoint,
  restoreCheckpointData,
  validateCheckpointGzip,
  validateCheckpointRestoreTarget,
} from '../../lib/checkpoint/restore.mts'
import { PLATFORM_AGNOSTIC_CHECKPOINTS } from '../../lib/constants.mts'

vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  readSync: vi.fn(),
  promises: { ...(await original()).promises, stat: vi.fn() },
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(),
}))
vi.mock(import('../../lib/checkpoint-lock.mts'), () => ({ withLock: vi.fn() }))
vi.mock(import('../../lib/extraction-cache.mts'), () => ({
  computeSourceHash: vi.fn(),
}))
vi.mock(import('../../lib/tarball-utils.mts'), () => ({
  extractTarball: vi.fn(),
}))
const config = {
  artifactHash: 'example-artifact-hash',
  extractDir: '/example/build',
  initialModTime: 1000,
  tarballPath: '/example/build/checkpoints/compiled.tar.gz',
  targetPath: '/example/build/output.node',
}
function stats(size = 30, mtimeMs = 1000) {
  const metadata = statSync(new URL(import.meta.url))
  metadata.size = size
  metadata.mtimeMs = mtimeMs
  metadata.mtime = new Date(mtimeMs)
  return metadata
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fs.stat).mockResolvedValue(stats())
  vi.mocked(computeSourceHash).mockReturnValue('example-artifact-hash')
  vi.mocked(withLock).mockImplementation(async (...args) => args[2]())
  vi.mocked(openSync).mockReturnValue(42)
  vi.mocked(readSync).mockImplementation((...args) => {
    const buffer = args[1]
    if (Buffer.isBuffer(buffer)) {
      if (buffer.length === 2) {
        buffer[0] = 0x1f
        buffer[1] = 0x8b
      } else {
        buffer.writeUInt32LE(1, 0)
      }
    }
    return Buffer.isBuffer(buffer) ? buffer.length : 0
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
test.each([0, 17, 2 * 1024 * 1024 * 1024 + 1])(
  'rejects invalid gzip size %s without opening it',
  size => {
    expect(validateCheckpointGzip(config.tarballPath, size)).toBe(false)
    expect(openSync).not.toHaveBeenCalled()
  },
)
test('accepts valid gzip framing and closes its descriptor', () => {
  expect(validateCheckpointGzip(config.tarballPath, 30)).toBe(true)
  expect(closeSync).toHaveBeenCalledWith(42)
})
test.each(['magic-first', 'magic-second', 'footer', 'read'])(
  'rejects corrupt gzip %s and closes its descriptor',
  defect => {
    vi.mocked(readSync).mockImplementation((...args) => {
      if (defect === 'read') {
        throw new Error('example read failure')
      }
      const buffer = args[1]
      if (Buffer.isBuffer(buffer) && buffer.length === 2) {
        buffer[0] = defect === 'magic-first' ? 0 : 0x1f
        buffer[1] = defect === 'magic-second' ? 0 : 0x8b
      }
      return Buffer.isBuffer(buffer) ? buffer.length : 0
    })
    expect(validateCheckpointGzip(config.tarballPath, 30)).toBe(false)
    expect(closeSync).toHaveBeenCalledWith(42)
  },
)
test('accepts a nonzero uncompressed size even with zero CRC', () => {
  vi.mocked(readSync).mockImplementation((...args) => {
    const buffer = args[1]
    if (Buffer.isBuffer(buffer)) {
      if (buffer.length === 2) {
        buffer[0] = 0x1f
        buffer[1] = 0x8b
      } else {
        buffer.writeUInt32LE(1, 4)
      }
    }
    return Buffer.isBuffer(buffer) ? buffer.length : 0
  })
  expect(validateCheckpointGzip(config.tarballPath, 30)).toBe(true)
})
test('rejects an archive that cannot be opened', () => {
  vi.mocked(openSync).mockImplementation(() => {
    throw new Error('example open failure')
  })
  expect(validateCheckpointGzip(config.tarballPath, 30)).toBe(false)
  expect(closeSync).not.toHaveBeenCalled()
})
test.each([
  [{ platform: 'darwin' }, { platform: 'linux' }],
  [{ arch: 'arm64' }, { arch: 'x64' }],
  [{}, { platform: 'linux' }],
  [{ platform: 'linux' }, {}],
  [{ libc: 'musl' }, { libc: 'glibc' }],
])('rejects incompatible restore metadata %j %j', (data, options) => {
  expect(() =>
    validateCheckpointRestoreTarget(data, 'compiled', options),
  ).toThrow()
})
test('source checkpoints do not require Linux binary metadata', () => {
  const source = [...PLATFORM_AGNOSTIC_CHECKPOINTS][0]!
  expect(() =>
    validateCheckpointRestoreTarget({ platform: 'linux' }, source, {
      platform: 'linux',
    }),
  ).not.toThrow()
  expect(() =>
    validateCheckpointRestoreTarget(
      { platform: 'linux', arch: 'x64', libc: 'musl' },
      'compiled',
      { platform: 'linux', arch: 'x64', libc: 'musl' },
    ),
  ).not.toThrow()
})
test.each([stats(0), stats(30, 2001)])(
  'refuses changed archives before extracting %j',
  snapshot => {
    vi.mocked(fs.stat).mockResolvedValue(snapshot)
    return expect(extractLockedCheckpoint(config))
      .rejects.toThrow()
      .then(() => expect(extractTarball).not.toHaveBeenCalled())
  },
)
test.each([undefined, 'different-artifact-hash'])(
  'rejects missing or mismatched extracted hash %s',
  artifactHash => {
    return expect(
      extractLockedCheckpoint({ ...config, artifactHash }),
    ).rejects.toThrow()
  },
)
test('validates extracted content relative to its destination', async () => {
  await extractLockedCheckpoint(config)
  expect(extractTarball).toHaveBeenCalledWith(
    config.tarballPath,
    config.extractDir,
  )
  expect(computeSourceHash).toHaveBeenCalledWith([config.targetPath], {
    relativeTo: config.extractDir,
  })
})
test('retries transient missing archives and eventually validates content', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  vi.mocked(fs.stat).mockRejectedValueOnce(
    Object.assign(new Error('example missing archive'), { code: 'ENOENT' }),
  )
  const result = extractCheckpointWithRetry(config)
  await vi.runAllTimersAsync()
  await result
  expect(withLock).toHaveBeenCalledTimes(2)
  expect(extractTarball).toHaveBeenCalledTimes(1)
})
test.each(['code', 'message'])(
  'bounds repeated disappearance retries via %s',
  shape => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const error =
      shape === 'code'
        ? Object.assign(new Error('example missing archive'), {
            code: 'ENOENT',
          })
        : new Error('ENOENT example archive')
    vi.mocked(fs.stat).mockRejectedValue(error)
    const result = expect(extractCheckpointWithRetry(config)).rejects.toThrow()
    return vi.runAllTimersAsync().then(async () => {
      await result
      expect(withLock).toHaveBeenCalledTimes(3)
    })
  },
)
test('does not retry archives old enough for permanent cleanup', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  vi.mocked(fs.stat).mockRejectedValue(
    Object.assign(new Error('example missing archive'), { code: 'ENOENT' }),
  )
  await expect(extractCheckpointWithRetry(config)).rejects.toThrow()
  expect(withLock).toHaveBeenCalledTimes(1)
})
test('does not retry other extraction failures', async () => {
  vi.mocked(extractTarball).mockRejectedValue(
    new Error('example extraction failure'),
  )
  await expect(extractCheckpointWithRetry(config)).rejects.toThrow()
  expect(withLock).toHaveBeenCalledTimes(1)
})
test('restores metadata-only checkpoints without disk mutation', async () => {
  expect(
    await restoreCheckpointData(
      '/example/build',
      'example-package',
      'compiled',
      {},
    ),
  ).toBe(true)
  expect(safeDelete).not.toHaveBeenCalled()
})
test('rejects artifact traversal before reading or deleting files', async () => {
  await expect(
    restoreCheckpointData('/example/build', 'example-package', 'compiled', {
      artifactPath: '../outside.node',
    }),
  ).rejects.toThrow()
  expect(fs.stat).not.toHaveBeenCalled()
  expect(safeDelete).not.toHaveBeenCalled()
})
test.each([undefined, '/example/restored'])(
  'restores checked artifacts at destination %s',
  destDir => {
    return restoreCheckpointData(
      '/example/build',
      'example-package',
      'compiled',
      { artifactPath: 'output.node', artifactHash: 'example-artifact-hash' },
      { destDir },
    ).then(result => {
      expect(result).toBe(true)
      expect(safeDelete).toHaveBeenCalledWith(
        `${destDir ?? '/example/build'}/output.node`,
      )
    })
  },
)
test('does not delete existing output for invalid gzip', async () => {
  vi.mocked(fs.stat).mockResolvedValue(stats(0))
  expect(
    await restoreCheckpointData(
      '/example/build',
      'example-package',
      'compiled',
      { artifactPath: 'output.node' },
    ),
  ).toBe(false)
  expect(safeDelete).not.toHaveBeenCalled()
})
test.each(['empty', 'missing', 'access'])(
  'rejects invalid extracted output %s',
  failure => {
    const mock = vi
      .mocked(fs.stat)
      .mockResolvedValueOnce(stats())
      .mockResolvedValueOnce(stats())
    if (failure === 'empty') {
      mock.mockResolvedValueOnce(stats(0))
    } else {
      mock.mockRejectedValueOnce(
        Object.assign(new Error('example output failure'), {
          code: failure === 'missing' ? 'ENOENT' : 'EACCES',
        }),
      )
    }
    return expect(
      restoreCheckpointData('/example/build', 'example-package', 'compiled', {
        artifactPath: 'output.node',
        artifactHash: 'example-artifact-hash',
      }),
    ).rejects.toThrow()
  },
)
