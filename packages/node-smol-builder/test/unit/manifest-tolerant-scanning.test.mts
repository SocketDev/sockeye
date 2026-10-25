import { expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import { parseLockfile } from '../../additions/source-patched/lib/internal/socketsecurity/manifest.js'
test.each(['\n', '\r\n'])(
  'Yarn tolerates blank and unknown metadata with %j separators',
  separator => {
    const content = [
      '# example lock',
      '',
      '  ',
      'unrecognized header',
      'example-module@^1:',
      '  version "1.0.0"',
      '  linkType',
      '  resolution',
      '  customMetadata: preserved-by-source',
      '  dependencies:',
      '    # example dependency comment',
      '    example-child: ^2',
      '  dependenciesMeta:',
      '    example-child:',
      '      optional: true',
      '',
      '__metadata:',
      '  version: 8',
    ].join(separator)
    const lock = parseLockfile(content, 'npm', 'yarn')
    expect(lock.packages).toHaveLength(1)
    expect(lock.packages[0]).toMatchObject({
      name: 'example-module',
      version: '1.0.0',
      dependencies: ['example-child'],
      isOptional: false,
    })
  },
)
test('pnpm without a version header uses the current package identifier layout', () => {
  const lock = parseLockfile(
    'packages:\n  example-module@1.2.3:\n    resolution: {}',
    'npm',
    'pnpm',
  )
  expect(lock.packages[0]).toMatchObject({
    name: 'example-module',
    version: '1.2.3',
  })
})
test('pnpm v5 identifiers preserve names and default missing versions', () => {
  const lock = parseLockfile(
    [
      "lockfileVersion: '5.0'",
      'packages:',
      '  /example-unversioned:',
      '    resolution: {}',
      '  /@example/scoped:',
      '    resolution: {}',
      '  /example-versioned/1.2.3:',
      '    resolution: {}',
    ].join('\n'),
    'npm',
    'pnpm',
  )
  expect(lock.packages.map(pkg => [pkg.name, pkg.version])).toEqual([
    ['example-unversioned', '0.0.0'],
    ['@example/scoped', '0.0.0'],
    ['example-versioned', '1.2.3'],
  ])
})
test('incomplete importer records and malformed dependency lines do not create phantom names', () => {
  const lock = parseLockfile(
    [
      "lockfileVersion: '9.0'",
      'importers:',
      '  .:',
      '    unknownMetadata: value',
      '    dependencies:',
      '      # ignored line',
      '      invalid line',
      '      example-block:',
      '        version: 1.0.0',
      'packages:',
      '  example-module@1.0.0:',
      '    dependencies:',
      '      invalid line',
      '      example-child: 2.0.0',
    ].join('\n'),
    'npm',
    'pnpm',
  )
  expect(lock.packages.map(pkg => pkg.name)).toEqual(['example-module'])
  expect(lock.packages[0]?.dependencies).toEqual(['example-child'])
})
