import { expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import { parseLockfile } from '../../additions/source-patched/lib/internal/socketsecurity/manifest.js'
test('empty npm lockfile defaults its format version without emitting dependencies', () => {
  const lock = parseLockfile('{}', 'npm', 'npm')
  expect(lock.lockVersion).toBe('1')
  expect(lock.packages).toEqual([])
})
test('npm package records without a resolved version retain a placeholder identity', () => {
  const lock = parseLockfile(
    JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/example-unversioned': {} },
    }),
    'npm',
    'npm',
  )
  expect(lock.packages[0]).toMatchObject({
    name: 'example-unversioned',
    version: '0.0.0',
  })
})
test.each([
  '# final comment',
  'example-incomplete@^1:',
  'patch:example-incomplete@custom:source:',
])('Yarn incomplete final record %s emits no package', source => {
  expect(parseLockfile(source, 'npm', 'yarn').packages).toEqual([])
})
