import { expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  createStreamingParser,
  findPackages,
  getPackage,
  getPackageVersions,
  parse,
  parseLockfile,
  parseManifest,
} from '../../additions/source-patched/lib/internal/socketsecurity/manifest.js'

const multipleVersions = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { name: 'example-root' },
    'node_modules/example-parser': { version: '1.0.0' },
    'node_modules/example-parent/node_modules/example-parser': {
      version: '2.0.0',
      dev: true,
    },
    'node_modules/example-other/node_modules/example-parser': {
      version: '3.0.0',
      optional: true,
    },
    'node_modules/@example/unique': { version: '4.0.0' },
  },
})

test('index queries retain all installed versions and return the first match', () => {
  const lock = parseLockfile(multipleVersions, 'npm', 'npm')
  const versions = getPackageVersions(lock, 'example-parser')
  expect(versions.map(pkg => pkg.version)).toEqual(['1.0.0', '2.0.0', '3.0.0'])
  expect(getPackage(lock, 'example-parser')).toBe(versions[0])
  expect(getPackageVersions(lock, '@example/unique')).toEqual([
    getPackage(lock, '@example/unique'),
  ])
  expect(getPackageVersions(lock, 'example-missing')).toEqual([])
  expect(getPackage({ packages: [] }, 'example-missing')).toBeUndefined()
})

test('streaming yields the same ordered package records as complete parsing', async () => {
  const packages = []
  for await (const pkg of createStreamingParser(multipleVersions, 'npm')) {
    packages.push(pkg)
  }
  expect(packages).toEqual(
    parseLockfile(multipleVersions, 'npm', 'npm').packages,
  )
  const empty = []
  for await (const pkg of createStreamingParser(
    '{"lockfileVersion":3,"packages":{}}',
    'npm',
  )) {
    empty.push(pkg)
  }
  expect(empty).toEqual([])
})

test.each(['cargo', 'pypi', 'unsupported'])(
  'rejects unavailable %s lockfile parsers explicitly',
  ecosystem => {
    expect(() => parseLockfile('', ecosystem)).toThrow()
    expect(() => parseManifest('{}', ecosystem)).toThrow()
  },
)

test.each(['npm', 'yarn', 'pnpm'])(
  'auto-detects %s lockfile content',
  format => {
    const content = {
      npm: multipleVersions,
      yarn: '# yarn lockfile v1\n\n"example-parser@^1":\n  version "1.0.0"\n',
      pnpm: "lockfileVersion: '9.0'\npackages:\n  example-parser@1.0.0:\n    dev: false\n",
    }[format]!
    expect(parseLockfile(content, 'npm').packages).toEqual(
      parseLockfile(content, 'npm', format).packages,
    )
  },
)

test('unknown lockfile data and invalid JSON fail rather than returning an empty inventory', () => {
  expect(() => parseLockfile('unknown', 'npm')).toThrow()
  expect(() => parseLockfile('{', 'npm', 'npm')).toThrow()
  expect(() => parse('example.unknown', '{}')).toThrow()
})

test('package search accepts the size boundary and rejects oversized or invalid patterns', () => {
  const lock = parseLockfile(multipleVersions, 'npm', 'npm')
  expect(findPackages(lock, 'example-parser').length).toBe(3)
  expect(findPackages(lock, 'x'.repeat(256))).toEqual([])
  expect(findPackages(lock, new RegExp('x'.repeat(256)))).toEqual([])
  expect(() => findPackages(lock, 'x'.repeat(257))).toThrow(RangeError)
  expect(() => findPackages(lock, new RegExp('x'.repeat(257)))).toThrow(
    RangeError,
  )
  expect(() => findPackages(lock, 123)).toThrow(TypeError)
})

test('v1 dependency nesting fails at the defensive depth limit', () => {
  let dependencies: Record<string, unknown> = {}
  for (let depth = 0; depth < 66; depth++) {
    dependencies = {
      [`example-depth-${depth}`]: { version: '1.0.0', dependencies },
    }
  }
  expect(() =>
    parseLockfile(
      JSON.stringify({ lockfileVersion: 1, dependencies }),
      'npm',
      'npm',
    ),
  ).toThrow(RangeError)
})

test('v1 repeated package identities do not create duplicate inventory entries', () => {
  const lock = parseLockfile(
    JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        'example-root': {
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
    'example-root',
    'example-child',
  ])
})

test.each([
  ['patch:example-parser@npm:1.0.0#example.patch', 'example-parser'],
  ['patch:@example/parser@npm%3A1.0.0#example.patch', '@example/parser'],
  ['example-parser@npm:^1.0.0', 'example-parser'],
  ['example-parser', 'example-parser'],
])('Yarn descriptor %s preserves package identity', (descriptor, name) => {
  const lock = parseLockfile(
    `__metadata:\n  version: 6\n\n"${descriptor}":\n  version: "1.0.0"\n  checksum: example-checksum\n  resolution: "https://example.test/parser.tgz"\n  dependencies:\n    example-child: "^2.0.0"\n  dependenciesMeta:\n    example-child:\n      optional: true\n  linkType: hard\n`,
    'npm',
    'yarn',
  )
  expect(lock.packages).toHaveLength(1)
  expect(lock.packages[0]).toMatchObject({
    name,
    version: '1.0.0',
    resolved: 'https://example.test/parser.tgz',
    dependencies: ['example-child'],
    isOptional: false,
  })
})

test('Yarn workspace declarations and soft links do not enter registry inventory', () => {
  const content =
    '__metadata:\n  version: 6\n"example-workspace@workspace:.":\n  version: "0.0.0"\n\n"example-link@npm:1":\n  version: "1.0.0"\n  linkType: soft\n\n"example-parser@^1, example-parser@~1":\n  version "1.0.0"\n  checksum example-checksum\n'
  expect(
    parseLockfile(content, 'npm', 'yarn').packages.map(pkg => pkg.name),
  ).toEqual(['example-parser'])
})

test('pnpm package flags and resolution metadata do not absorb sibling section entries', () => {
  const content =
    "lockfileVersion: '9.0'\npackages:\n  example-parser@1.0.0:\n    dev: true\n    optional: true\n    resolution: {integrity: sha512-ZXhhbXBsZQ==, tarball: 'https://example.test/parser.tgz'}\n    dependencies:\n      example-child: 2.0.0\n    engines:\n      node: '>=20'\n  example-parser@2.0.0:\n    integrity: sha512-ZXhhbXBsZQ==\n  example-parser@3.0.0:\n    dev: false\n"
  const lock = parseLockfile(content, 'npm', 'pnpm')
  expect(
    getPackageVersions(lock, 'example-parser').map(pkg => pkg.version),
  ).toEqual(['1.0.0', '2.0.0', '3.0.0'])
  expect(lock.packages).toHaveLength(3)
  expect(lock.packages[0]).toMatchObject({
    isDev: true,
    isOptional: true,
    dependencies: ['example-child'],
    resolved: 'https://example.test/parser.tgz',
    integrity: 'sha512-ZXhhbXBsZQ==',
  })
})
