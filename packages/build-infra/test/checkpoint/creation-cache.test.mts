import { beforeEach, expect, test, vi } from 'vitest'
import { computeCreationCacheHash } from '../../lib/checkpoint/creation-cache.mts'
import { computeSourceHash } from '../../lib/extraction-cache.mts'
import { PLATFORM_AGNOSTIC_CHECKPOINTS } from '../../lib/constants.mts'

vi.mock(import('../../lib/extraction-cache.mts'), () => ({
  computeSourceHash: vi.fn(() => 'example-source-hash'),
}))
vi.mock(import('../../lib/checkpoint-cache-key.mts'), async original => ({
  ...(await original()),
  computeBuildCacheEnvMetadata: () => '',
}))
beforeEach(() => vi.clearAllMocks())
const sourceStage = [...PLATFORM_AGNOSTIC_CHECKPOINTS][0]!

test('does not compute a source hash without a source list', () => {
  expect(computeCreationCacheHash('binary-released', {})).toBeUndefined()
  expect(
    Reflect.apply(computeCreationCacheHash, undefined, [
      'binary-released',
      { sourcePaths: 'invalid-list' },
    ]),
  ).toBeUndefined()
  expect(computeSourceHash).not.toHaveBeenCalled()
})
test('requires metadata for a platform-specific source cache', () => {
  expect(() =>
    computeCreationCacheHash('binary-released', { sourcePaths: [] }),
  ).toThrow()
  expect(computeSourceHash).not.toHaveBeenCalled()
})
test('allows platform-independent sources without target metadata', () => {
  expect(computeCreationCacheHash(sourceStage, { sourcePaths: [] })).toBe(
    'example-source-hash',
  )
  expect(computeSourceHash).toHaveBeenCalledWith([], {
    platformMetadata: undefined,
  })
})
test.each([undefined, 'musl'])(
  'includes binary build metadata with libc %s',
  libc => {
    computeCreationCacheHash('binary-released', {
      sourcePaths: ['example.cc'],
      platform: 'linux',
      arch: 'x64',
      libc,
      nodeVersion: '26.0.0',
      buildMode: 'prod',
      withLief: true,
      configureFlags: '--without-example',
    })
    const metadata =
      vi.mocked(computeSourceHash).mock.calls[0]?.[1]?.platformMetadata
    expect(metadata).toContain(libc ? 'linux-x64-musl' : 'linux-x64')
    expect(metadata).toContain('node-26.0.0')
    expect(metadata).toContain('lief-true')
    expect(metadata).toMatch(/config-[a-f0-9]{8}/u)
  },
)
test('keeps version metadata independent of an incomplete target', () => {
  computeCreationCacheHash('binary-released', {
    sourcePaths: [],
    platform: 'darwin',
    nodeVersion: '26.0.0',
  })
  expect(computeSourceHash).toHaveBeenCalledWith([], {
    platformMetadata: 'node-26.0.0',
  })
})
