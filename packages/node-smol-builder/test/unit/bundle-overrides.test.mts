import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { readBundleOverrides } from '../../scripts/lib/bundle-overrides.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await safeDelete(directory)
  }
})

test('reads only feature overrides from a package manifest', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bundle-overrides-'))
  directories.push(directory)
  const manifest = path.join(directory, 'package.json')
  await writeFile(
    manifest,
    JSON.stringify({
      name: 'example-bundle',
      smol: { keep: ['sqlite'], drop: ['quic'], extra: true },
    }),
  )
  const result = await readBundleOverrides(manifest)
  expect(result).toEqual({ keep: ['sqlite'], drop: ['quic'] })
  expect(Object.getPrototypeOf(result)).toBeNull()
})

test('accepts an omitted manifest or missing override section', async () => {
  expect(await readBundleOverrides(undefined)).toBeUndefined()
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bundle-overrides-'))
  directories.push(directory)
  const manifest = path.join(directory, 'package.json')
  await writeFile(manifest, '{}')
  expect(await readBundleOverrides(manifest)).toBeUndefined()
})
