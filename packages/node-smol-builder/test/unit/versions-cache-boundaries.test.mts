import { afterEach, expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  cacheStats,
  clearCache,
  compare,
  parse,
  satisfies,
} from '../../additions/source-patched/lib/internal/socketsecurity/versions.js'

afterEach(clearCache)

test('bounds the parsed version cache and evicts the oldest entry', () => {
  clearCache()
  const oldest = parse('0.0.0')
  for (let patch = 1; patch <= 50_000; patch++) {
    parse(`0.0.${patch}`)
  }
  expect(cacheStats().size).toBe(50_000)
  expect(parse('0.0.0')).not.toBe(oldest)
  expect(cacheStats().size).toBe(50_000)
  expect(cacheStats().misses).toBe(50_002)
})

test.each([
  ['1.0-alpha1', '1.0-alpha2'],
  ['1.0-custom1', '1.0-custom2'],
])('orders numbered Maven qualifiers %s before %s', (lower, higher) => {
  expect(compare(lower, higher, 'maven')).toBe(-1)
  expect(compare(higher, lower, 'maven')).toBe(1)
})

test.each([
  ['0.1.0', '^0.2', false],
  ['0.0.1', '^0.0', true],
  ['0.1.0', '^0.0', false],
  ['1.2.0', '~1.3', false],
  ['2.3.0', '1.x', false],
  ['1.3.0', '1.2.x', false],
  ['1.2.3', '1.2.3 - 1.2.4', true],
  ['1.2.5', '1.2.3 - 1.2.4', false],
  ['1.2.3-beta.1', '>=1.2.3-beta.0 <2.0.0', true],
  ['1.2.4-beta.1', '>=1.2.3-beta.0 <2.0.0', false],
])('evaluates %s against boundary range %s', (version, range, expected) => {
  expect(satisfies(version, range)).toBe(expected)
})
