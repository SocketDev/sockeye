import { beforeEach, expect, test, vi } from 'vitest'
import { promises as fs, renameSync } from 'node:fs'
import process from 'node:process'
import { safeDeleteSync, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { adHocSign } from '../../lib/sign.mts'
import { createCheckpointArchive } from '../../lib/checkpoint/archive.mts'
import { computeCreationCacheHash } from '../../lib/checkpoint/creation-cache.mts'
import { cleanupPreviousCheckpoint } from '../../lib/checkpoint/cleanup.mts'
import {
  createCheckpoint,
  describeCheckpointTarget,
  validateCheckpointCreation,
} from '../../lib/checkpoint/create.mts'
import { PLATFORM_AGNOSTIC_CHECKPOINTS } from '../../lib/constants.mts'
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  renameSync: vi.fn(),
  promises: { ...(await original()).promises, writeFile: vi.fn() },
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDeleteSync: vi.fn(),
  safeMkdir: vi.fn(),
}))
vi.mock(import('../../lib/sign.mts'), () => ({ adHocSign: vi.fn() }))
vi.mock(import('../../lib/checkpoint/archive.mts'), () => ({
  createCheckpointArchive: vi.fn(),
}))
vi.mock(import('../../lib/checkpoint/creation-cache.mts'), () => ({
  computeCreationCacheHash: vi.fn(),
}))
vi.mock(import('../../lib/checkpoint/cleanup.mts'), () => ({
  cleanupPreviousCheckpoint: vi.fn(),
}))
const source = [...PLATFORM_AGNOSTIC_CHECKPOINTS][0]!
const target = { arch: 'arm64', libc: undefined, platform: 'darwin' }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(computeCreationCacheHash).mockReturnValue('example-cache-hash')
  vi.mocked(createCheckpointArchive).mockResolvedValue({
    checkpointAlreadyExists: false,
    artifactHash: 'example-artifact-hash',
  })
})
test.each([
  [{ platform: undefined, arch: undefined, libc: undefined }, 'compiled'],
  [{ platform: 'linux', arch: undefined, libc: undefined }, 'compiled (linux)'],
  [
    { platform: 'linux', arch: 'x64', libc: 'musl' },
    'compiled (linux-x64-musl)',
  ],
  [target, 'compiled (darwin-arm64)'],
])('describes the explicit checkpoint target %j', (options, expected) => {
  expect(describeCheckpointTarget('compiled', options)).toBe(expected)
})
test.each([{}, { platform: 'darwin' }, { arch: 'arm64' }])(
  'rejects incomplete binary targets %j',
  options => {
    expect(() =>
      Reflect.apply(validateCheckpointCreation, undefined, [
        'compiled',
        vi.fn(),
        options,
      ]),
    ).toThrow()
  },
)
test.each([{}, 'invalid callback', undefined])(
  'requires executable smoke validation %j',
  callback => {
    expect(() =>
      Reflect.apply(validateCheckpointCreation, undefined, [
        source,
        callback,
        target,
      ]),
    ).toThrow()
  },
)
test('failed smoke validation preserves its cause and writes nothing', async () => {
  const failure = new Error('example smoke rejection')
  await expect(
    createCheckpoint(
      '/example/build',
      source,
      vi.fn().mockRejectedValue(failure),
    ),
  ).rejects.toMatchObject({ cause: failure })
  expect(fs.writeFile).not.toHaveBeenCalled()
  expect(safeMkdir).not.toHaveBeenCalled()
})
test.each([process.cwd(), '/example/package'])(
  'signs before smoke validation and persists artifact identity for %s',
  async packageRoot => {
    const smoke = vi.fn(async () => {
      expect(adHocSign).toHaveBeenCalledWith('/example/build/output.node')
    })
    await createCheckpoint('/example/build', 'compiled', smoke, {
      ...target,
      packageRoot,
      binaryPath: 'output.node',
      artifactPath: 'output.node',
      packageName: 'example-package',
    })
    expect(smoke).toHaveBeenCalledTimes(1)
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/compiled.json.tmp.'),
      expect.stringContaining('"artifactHash": "example-artifact-hash"'),
      'utf8',
    )
    expect(renameSync).toHaveBeenCalledWith(
      expect.any(String),
      '/example/build/checkpoints/example-package/compiled.json',
    )
    expect(cleanupPreviousCheckpoint).toHaveBeenCalledTimes(1)
  },
)
test('preserves metadata when a concurrent archive already exists', async () => {
  vi.mocked(createCheckpointArchive).mockResolvedValue({
    checkpointAlreadyExists: true,
    artifactHash: 'example-artifact-hash',
  })
  await createCheckpoint('/example/build', source, vi.fn(), {
    artifactPath: 'output.node',
  })
  expect(fs.writeFile).not.toHaveBeenCalled()
  expect(cleanupPreviousCheckpoint).toHaveBeenCalledTimes(1)
})
test.each(['EEXIST', 'EPERM'])(
  'cleans only temporary metadata on competing writer %s',
  async code => {
    vi.mocked(renameSync).mockImplementation(() => {
      throw Object.assign(new Error('example rename collision'), { code })
    })
    await createCheckpoint('/example/build', source, vi.fn())
    expect(safeDeleteSync).toHaveBeenCalledWith(
      expect.stringContaining('.json.tmp.'),
    )
    expect(cleanupPreviousCheckpoint).toHaveBeenCalledTimes(1)
  },
)
test('propagates other publication errors without pruning earlier checkpoints', async () => {
  const failure = Object.assign(new Error('example rename failure'), {
    code: 'EIO',
  })
  vi.mocked(renameSync).mockImplementation(() => {
    throw failure
  })
  await expect(
    createCheckpoint('/example/build', source, vi.fn()),
  ).rejects.toBe(failure)
  expect(cleanupPreviousCheckpoint).not.toHaveBeenCalled()
})
