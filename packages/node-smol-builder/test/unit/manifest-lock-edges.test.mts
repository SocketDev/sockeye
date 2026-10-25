import { expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  getPackageVersions,
  parseLockfile,
  parseManifest,
} from '../../additions/source-patched/lib/internal/socketsecurity/manifest.js'

test('npm paths retain incomplete scopes and strip nested package-relative suffixes', () => {
  const lock = parseLockfile(
    JSON.stringify({
      packages: {
        'node_modules/@example': { version: '1.0.0' },
        'node_modules/example/subdirectory': { version: '2.0.0' },
        'workspace/example': { version: '3.0.0', name: 'example-workspace' },
      },
    }),
    'npm',
    'npm',
  )
  expect(lock.packages.map(pkg => pkg.name)).toEqual([
    '@example',
    'example',
    'example-workspace',
  ])
})

test('npm v1 deduplicates repeated name/version pairs while preserving distinct descendants', () => {
  const lock = parseLockfile(
    JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        'example-parent': {
          version: '1.0.0',
          dependencies: { 'example-child': { version: '2.0.0' } },
        },
        'example-child': { version: '2.0.0' },
      },
    }),
    'npm',
    'npm',
  )
  expect(lock.packages.map(pkg => pkg.name)).toEqual([
    'example-parent',
    'example-child',
  ])
})

test('Yarn encoded patch descriptors retain package identity and workspace entries stay excluded', () => {
  const lock = parseLockfile(
    `__metadata:\n  version: 8\n"patch:example@npm%3A1.0.0#example.patch":\n  version: 1.0.0\n"patch:example@npm:2.0.0#example.patch":\n  version: 2.0.0\n"example@npm:3.0.0":\n  version: 3.0.0\n"example-workspace@workspace:packages/example":\n  version: 4.0.0\n`,
    'npm',
    'yarn',
  )
  expect(getPackageVersions(lock, 'example-workspace')).toEqual([])
  expect(getPackageVersions(lock, 'example').map(pkg => pkg.version)).toEqual([
    '1.0.0',
    '2.0.0',
    '3.0.0',
  ])
})

test('Yarn bare descriptors and local resolved paths remain readable', () => {
  const lock = parseLockfile(
    'example-module:\n  version "1.0.0"\n  resolved "example.tgz"\n  integrity sha512-example\n',
    'npm',
    'yarn',
  )
  expect(lock.packages[0]).toMatchObject({
    name: 'example-module',
    version: '1.0.0',
    resolved: 'example.tgz',
    integrity: 'sha512-example',
  })
})

test.each([
  ['6.0', "'"],
  ['8.0', "'"],
  ['9.0', "'"],
  ['9.0', '"'],
])(
  'pnpm version %s with quote %s handles scoped identifiers and unversioned entries',
  (version, quote) => {
    const lock = parseLockfile(
      `lockfileVersion: '${version}'\npackages:\n  ${quote}@example/module@1.2.3${quote}:\n    resolution: {integrity: sha512-example}\n  example-unversioned:\n    resolution: {integrity: sha512-other}\n`,
      'npm',
      'pnpm',
    )
    expect(lock.packages.map(pkg => [pkg.name, pkg.version])).toEqual([
      ['@example/module', '1.2.3'],
      ['example-unversioned', '0.0.0'],
    ])
  },
)

test('pnpm v5 retains a malformed scope for diagnostics rather than dropping its record', () => {
  const lock = parseLockfile(
    "lockfileVersion: '5.4'\npackages:\n  /@example:\n    resolution: {integrity: sha512-example}\n",
    'npm',
    'pnpm',
  )
  expect(lock.packages[0]).toMatchObject({ name: '@example', version: '0.0.0' })
})

test('manifest repository metadata accepts both string and object shapes', () => {
  expect(
    parseManifest('{"repository":"https://example.com/repo"}', 'npm')
      .repository,
  ).toBe('https://example.com/repo')
  expect(parseManifest('{"repository":{}}', 'npm').repository).toBeUndefined()
})
