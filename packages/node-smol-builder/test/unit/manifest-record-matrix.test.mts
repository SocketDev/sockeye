import { expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import { parseLockfile } from '../../additions/source-patched/lib/internal/socketsecurity/manifest.js'

test('npm v1 cuts recursive identity cycles and retains dependency classification', () => {
  const lock = parseLockfile(
    JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        'example-parent': {
          version: '1.0.0',
          dev: true,
          requires: { 'example-child': '^1' },
          dependencies: {
            'example-parent': {
              version: '1.0.0',
              dependencies: { 'example-unreachable': { version: '1.0.0' } },
            },
            'example-child': { version: '1.0.0', optional: true },
          },
        },
        'example-peer': { version: '1.0.0', peer: true },
        'example-unversioned': {},
        'example-malformed-alias': { version: 'npm:unqualified' },
      },
    }),
    'npm',
    'npm',
  )
  expect(lock.packages.map(pkg => [pkg.name, pkg.depType])).toEqual([
    ['example-parent', 'dev'],
    ['example-child', 'optional'],
    ['example-peer', 'peer'],
    ['example-unversioned', 'prod'],
    ['example-malformed-alias', 'prod'],
  ])
  expect(lock.packages[0]?.dependencies).toEqual(['example-child'])
  expect(lock.packages[3]?.version).toBe('0.0.0')
})

test('Yarn descriptor variants retain registry identity and colon-style integrity', () => {
  const lock = parseLockfile(
    [
      'patch:example-workspace@workspace:root:',
      '  version: "2.0.0"',
      'example-standard@workspace:^3:',
      '  version: "3.0.0"',
      'example-bare:',
      '  version: "4.0.0"',
      '  integrity: sha512-example',
      'example-registry@npm:^5:',
      '  version: "5.0.0"',
      '  integrity: sha512-registry',
    ].join('\n'),
    'npm',
    'yarn',
  )
  expect(lock.packages.map(pkg => [pkg.name, pkg.version])).toEqual([
    ['example-bare', '4.0.0'],
    ['example-registry', '5.0.0'],
  ])
  expect(lock.packages.map(pkg => pkg.integrity)).toEqual([
    'sha512-example',
    'sha512-registry',
  ])
})

test('pnpm importer sections assign dev and optional flags and remove peer suffixes', () => {
  const lock = parseLockfile(
    [
      "lockfileVersion: '6.0'",
      'importers:',
      '  .:',
      '    devDependencies:',
      '      example-dev: 1.0.0_peer@2',
      '    optionalDependencies:',
      '      example-optional: 2.0.0(peer@3)',
      '    dependencies:',
      '      example-prod: 3.0.0',
      '      example-local: workspace:*',
      '      example-directory: file:../example',
    ].join('\n'),
    'npm',
    'pnpm',
  )
  expect(
    lock.packages.map(pkg => [
      pkg.name,
      pkg.version,
      pkg.isDev,
      pkg.isOptional,
    ]),
  ).toEqual([
    ['example-dev', '1.0.0', true, false],
    ['example-optional', '2.0.0', false, true],
    ['example-prod', '3.0.0', false, false],
  ])
})

test.each(['5.0', '6.0', '9.0'])(
  'pnpm %s ignores incomplete metadata without phantom dependency records',
  version => {
    const lock = parseLockfile(
      `lockfileVersion: '${version}'\npackages:\n  example-empty:\n    resolution: {}\n    engines: {}\n    dependencies: {}\n`,
      'npm',
      'pnpm',
    )
    expect(lock.packages.map(pkg => pkg.name)).toEqual(['example-empty'])
    expect(lock.packages[0]?.version).toBe('0.0.0')
  },
)

test.each([
  ['__metadata:\n  version: 8', []],
  ['example-workspace@workspace:*:\n  version: 1.0.0', []],
  [
    'example-module@^1:\n  version "1.0.0"\n  dependencies:\n    example-child: ^2',
    ['example-child'],
  ],
  [
    'example-module@^1:\n  version "1.0.0"\n  dependenciesMeta:\n    example-child:\n      optional: true',
    [],
  ],
])(
  'Yarn consumes final unterminated block without swallowing a package: %s',
  (content, dependencies) => {
    const terminated = parseLockfile(`${content}\n`, 'npm', 'yarn')
    const unterminated = parseLockfile(content, 'npm', 'yarn')
    expect(unterminated).toEqual(terminated)
    if (unterminated.packages.length) {
      expect(unterminated.packages[0]?.dependencies).toEqual(dependencies)
      expect(unterminated.packages[0]?.isOptional).toBe(false)
    } else {
      expect(unterminated.packages).toEqual([])
    }
  },
)

test.each([
  'peerDependencies',
  'optionalDependencies',
  'engines',
  'os',
  'cpu',
  'bin',
])('pnpm %s ends the runtime dependency list', section => {
  const lock = parseLockfile(
    [
      "lockfileVersion: '9.0'",
      'packages:',
      '  example-module@1.0.0:',
      '    dev: false',
      '    optional: false',
      '    dependencies:',
      '      example-child: 2.0.0',
      `    ${section}:`,
      '      example-metadata: value',
    ].join('\n'),
    'npm',
    'pnpm',
  )
  expect(lock.packages[0]).toMatchObject({
    name: 'example-module',
    dependencies: ['example-child'],
    isDev: false,
    isOptional: false,
  })
})
