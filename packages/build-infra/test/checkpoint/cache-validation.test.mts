import { beforeEach, expect, test, vi } from 'vitest'
import {
  computeBinaryCheckpointHash,
  validateCheckpointBuildOptions,
} from '../../lib/checkpoint/cache-validation.mts'
import { computeSourceHash } from '../../lib/extraction-cache.mts'

vi.mock(import('../../lib/extraction-cache.mts'), () => ({
  computeSourceHash: vi.fn(() => 'example-source-hash'),
}))
vi.mock(import('../../lib/checkpoint-cache-key.mts'), async original => ({
  ...(await original()),
  computeBuildCacheEnvMetadata: () => '',
}))
beforeEach(() => vi.clearAllMocks())

test.each([
  {},
  { platform: 'darwin' },
  { arch: 'arm64' },
  { platform: '', arch: '' },
  { platform: 'linux', arch: 'x64' },
])('rejects incomplete target identity %j', config => {
  expect(() =>
    computeBinaryCheckpointHash('binary-released', ['example.cc'], config),
  ).toThrow()
  expect(computeSourceHash).not.toHaveBeenCalled()
})
test.each(['dev', 'prod', 'int4', 'int8', ''])(
  'accepts build mode %s',
  buildMode => {
    expect(() => validateCheckpointBuildOptions({ buildMode })).not.toThrow()
  },
)
test.each([
  { buildMode: 'invalid-mode' },
  { withLief: 'true' },
  { configureFlags: 17 },
])('rejects invalid build configuration %j', config => {
  expect(() =>
    Reflect.apply(validateCheckpointBuildOptions, undefined, [config]),
  ).toThrow()
})
test('hashes source with target, build configuration and version', () => {
  expect(
    computeBinaryCheckpointHash('binary-released', ['example.cc'], {
      platform: 'linux',
      arch: 'x64',
      libc: 'musl',
      nodeVersion: '26.0.0',
      buildMode: 'prod',
      withLief: false,
      configureFlags: '--without-example',
    }),
  ).toBe('example-source-hash')
  const metadata =
    vi.mocked(computeSourceHash).mock.calls[0]?.[1]?.platformMetadata
  expect(metadata).toContain('linux-x64-musl')
  expect(metadata).toContain('node-26.0.0')
  expect(metadata).toContain('build-prod')
  expect(metadata).toContain('lief-false')
  expect(metadata).toMatch(/config-[a-f0-9]{8}/u)
})
test('omits optional metadata while preserving target identity', () => {
  computeBinaryCheckpointHash('binary-released', [], {
    platform: 'darwin',
    arch: 'arm64',
  })
  expect(computeSourceHash).toHaveBeenCalledWith([], {
    platformMetadata: 'darwin-arm64',
  })
})
