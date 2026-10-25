import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, expect, test } from 'vitest'
import { resolveFastWebstreamsManifest } from '../../scripts/vendor-fast-webstreams/sync.mts'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await safeDelete(directory)
  }
})

test('resolves an installed package outside the checkout without an exported manifest', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'webstreams-resolver-'))
  directories.push(root)
  const checkout = path.join(root, 'checkout')
  const installed = path.join(root, 'store', 'experimental-fast-webstreams')
  const modules = path.join(checkout, 'node_modules')
  mkdirSync(installed, { recursive: true })
  mkdirSync(modules, { recursive: true })
  const manifest = path.join(installed, 'package.json')
  writeFileSync(
    manifest,
    JSON.stringify({
      name: 'experimental-fast-webstreams',
      version: '0.0.0',
      exports: { '.': './index.js' },
    }),
  )
  writeFileSync(path.join(installed, 'index.js'), 'export {}')
  symlinkSync(
    installed,
    path.join(modules, 'experimental-fast-webstreams'),
    'junction',
  )
  const resolved = resolveFastWebstreamsManifest({
    parentUrl: pathToFileURL(path.join(checkout, 'sync.mts')).href,
  })
  expect(realpathSync(resolved)).toBe(realpathSync(manifest))
  expect(JSON.parse(readFileSync(resolved, 'utf8'))).toMatchObject({
    name: 'experimental-fast-webstreams',
    version: '0.0.0',
  })
})

test('does not fall back to another installed package when the dependency is missing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'webstreams-missing-'))
  directories.push(root)
  expect(() =>
    resolveFastWebstreamsManifest({
      parentUrl: pathToFileURL(path.join(root, 'sync.mts')).href,
    }),
  ).toThrow()
})
