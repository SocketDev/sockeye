import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  BUILD_CACHE_ENV_VARS,
  computeBuildCacheEnvMetadata,
} from '../lib/checkpoint-cache-key.mts'
beforeEach(() => {
  for (const name of BUILD_CACHE_ENV_VARS) {
    vi.stubEnv(name, undefined)
  }
})
afterEach(() => vi.unstubAllEnvs())
test('unset build environment contributes no cache segment', () => {
  expect(computeBuildCacheEnvMetadata()).toBeUndefined()
})
test.each(BUILD_CACHE_ENV_VARS)(
  '%s changes invalidate the build environment fingerprint',
  name => {
    vi.stubEnv(name, 'example-first')
    const first = computeBuildCacheEnvMetadata()
    expect(first).toBeDefined()
    expect(computeBuildCacheEnvMetadata()).toBe(first)
    vi.stubEnv(name, 'example-second')
    expect(computeBuildCacheEnvMetadata()).not.toBe(first)
    expect(computeBuildCacheEnvMetadata()).not.toContain('example-second')
  },
)
test('empty environment overrides differ from an absent variable', () => {
  vi.stubEnv('CFLAGS', '')
  expect(computeBuildCacheEnvMetadata()).toBeDefined()
})
