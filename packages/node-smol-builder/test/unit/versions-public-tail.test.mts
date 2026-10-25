import { afterEach, expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  clearCache,
  coerce,
  parse,
  satisfies,
} from '../../additions/source-patched/lib/internal/socketsecurity/versions.js'

afterEach(clearCache)

test('coerces a partial version embedded in text with a zero patch', () => {
  expect(coerce('example release 2.3')).toBe('2.3.0')
})

test.each([
  ['0.2.0', true],
  ['0.99.5', true],
  ['1.0.0', false],
] as const)('zero-major wildcard evaluates %s', (version, expected) => {
  expect(satisfies(parse(version), '0.x')).toBe(expected)
})

test.each([
  ['1.2.0', true],
  ['1.2.99', true],
  ['1.1.99', false],
  ['1.3.0', false],
] as const)('tilde wildcard patch evaluates %s', (version, expected) => {
  expect(satisfies(parse(version), '~1.2.x')).toBe(expected)
})

test.each([
  ['1.5.0', '|| >=2.0.0', true],
  ['2.1.0', '|| >=2.0.0', true],
  ['1.5.0-alpha', '|| >=2.0.0', false],
  ['1.5.0', '>=2.0.0 ||', true],
  ['2.1.0', '>=2.0.0 ||', true],
  ['1.5.0-alpha', '>=2.0.0 ||', false],
  ['1.5.0', '>=2.0.0 || || <1.0.0', true],
  ['2.1.0', '>=2.0.0 || || <1.0.0', true],
  ['1.5.0-alpha', '>=2.0.0 || || <1.0.0', false],
] as const)(
  'empty OR operand preserves release and prerelease matching for %s in %s',
  (version, range, expected) => {
    expect(satisfies(parse(version), range)).toBe(expected)
  },
)
