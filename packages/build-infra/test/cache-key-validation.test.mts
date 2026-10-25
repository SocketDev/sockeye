import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  generateCacheKey,
  getDependencyVersions,
  parseCacheKey,
} from '../lib/cache-key.mts'
let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-key-validation-'))
})
afterEach(async () => {
  await safeDelete(root)
})
test.each(['', '1..2', '1.beta.2', '12345678901.0.0'])(
  'invalid package version %s cannot produce a cache key',
  packageVersion => {
    expect(() =>
      generateCacheKey({ packageVersion, nodeVersion: '24.0.0' }),
    ).toThrow()
  },
)
test.each(['0,1,1.123', '11,1,1.123', '2,2,2.123', '1,1.123', ',1.1'])(
  'malformed component lengths %s cannot reconstruct a package version',
  suffix => {
    expect(
      parseCacheKey(`v24.0.0-linux-x64-0123456789abcdef-${suffix}`),
    ).toBeUndefined()
  },
)
test('source read failures retain the filesystem cause', () => {
  expect(() =>
    generateCacheKey({
      packageVersion: '1.0.0',
      nodeVersion: '24.0.0',
      contentFiles: [root],
    }),
  ).toThrow()
})
test('dependency extraction rejects unavailable or corrupt manifests and omits absent names', async () => {
  const manifest = path.join(root, 'package.json')
  expect(() => getDependencyVersions(manifest, ['example'])).toThrow()
  await writeFile(manifest, '{')
  expect(() => getDependencyVersions(manifest, ['example'])).toThrow()
  await writeFile(
    manifest,
    JSON.stringify({
      dependencies: {},
      devDependencies: { 'example-dev': '1.0.0' },
    }),
  )
  expect(
    getDependencyVersions(manifest, ['example-absent', 'example-dev']),
  ).toEqual({ 'example-dev': '1.0.0' })
})
