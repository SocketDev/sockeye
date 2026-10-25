import { createRequire } from 'node:module'
import { expect, test } from 'vitest'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

interface TestAddon {
  get(...args: unknown[]): string | undefined
  set(...args: unknown[]): undefined
  del(...args: unknown[]): undefined
}
const binary = getNativeTestBinaryPath('sockeye-addon-test.node')
const imports = spawnSync('xcrun', ['nm', '-u', binary], { encoding: 'utf8' })
expect(imports.status).toBe(0)
expect(imports.stdout).not.toMatch(
  /_(?:SecItem\w+|SecAccessControl\w+|OBJC_CLASS_\$_LAContext)\b/u,
)
const require = createRequire(import.meta.url)
const addon: TestAddon = require(binary)

test('real addon exports round-trip only through the isolated backend', () => {
  expect(Object.keys(addon).sort()).toEqual(['del', 'get', 'set'])
  expect(addon.get('example-service', 'example-account')).toBeUndefined()
  expect(
    addon.set('example-service', 'example-account', 'example-placeholder'),
  ).toBeUndefined()
  expect(addon.get('example-service', 'example-account')).toBe(
    'example-placeholder',
  )
  expect(addon.del('example-service', 'example-account')).toBeUndefined()
  expect(addon.del('example-service', 'example-account')).toBeUndefined()
  expect(addon.get('example-service', 'example-account')).toBeUndefined()
})

test.each(['example-denied', 'example-unavailable', 'example-io'])(
  '%s raises an error for each operation',
  service => {
    for (const [method, args] of [
      ['get', [service, 'example-account']],
      ['set', [service, 'example-account', 'example-placeholder']],
      ['del', [service, 'example-account']],
    ] as const)
      expect(() => addon[method](...args)).toThrow(Error)
  },
)

test.each(['get', 'set', 'del'] as const)(
  '%s rejects invalid identities before the backend',
  method => {
    const before = addon.get('example-call-count', 'example-account')
    for (const args of [
      [],
      ['example-service'],
      [42, 'example-account'],
      ['example-service', null],
      ['x'.repeat(256), 'example-account'],
      ['example-service', 'x'.repeat(256)],
      ['é'.repeat(128), 'example-account'],
      ['example-service', 'é'.repeat(128)],
      ['example\0service', 'example-account'],
      ['example-service', 'example\0account'],
    ]) {
      const values =
        method === 'set' && args.length >= 2
          ? [...args, 'example-placeholder']
          : args
      expect(() => addon[method](...values)).toThrow(TypeError)
    }
    expect(addon.get('example-call-count', 'example-account')).toBe(before)
  },
)

test('set validates value byte length and type without calling the backend', () => {
  const before = addon.get('example-call-count', 'example-account')
  for (const value of [
    undefined,
    42,
    {},
    'x'.repeat(8192),
    'é'.repeat(4096),
    'example\0value',
  ]) {
    expect(() =>
      addon.set('example-service', 'example-account', value),
    ).toThrow(TypeError)
  }
  expect(addon.get('example-call-count', 'example-account')).toBe(before)
})

test('UTF8 limits accept complete values at the byte boundary', () => {
  const service = `${'é'.repeat(127)}x`
  const account = 'x'.repeat(255)
  const value = `${'é'.repeat(4095)}x`
  expect(addon.set(service, account, value)).toBeUndefined()
  expect(addon.get(service, account)).toBe(value)
  expect(addon.del(service, account)).toBeUndefined()
})
