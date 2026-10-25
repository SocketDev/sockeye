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

test.each([
  ['1.2.3', '=1', true],
  ['2.0.0', '=1', false],
  ['1.2.3', '=1.2', true],
  ['1.3.0', '=1.2', false],
  ['1.2.3', '=1.x', true],
  ['1.2.3', '=1.2.x', true],
  ['1.2.3', '>=1.x', true],
  ['0.9.0', '>=1.x', false],
  ['2.9.9', '1 - 2', true],
  ['3.0.0', '1 - 2', false],
  ['2.3.99', '1 - 2.3', true],
  ['2.4.0', '1 - 2.3', false],
  ['2.9.9', '1 - 2.x', true],
  ['2.3.99', '1 - 2.3.x', true],
  ['1.2.3', '1 - invalid', false],
  ['1.2.3', '>=invalid', false],
  ['1.2.3', '^invalid', false],
  ['1.2.3', '~invalid', false],
  ['1.2.3', '=invalid', false],
  ['invalid', '*', false],
])(
  'evaluates partial or malformed range %s against %s',
  (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected)
  },
)

test('compiled ranges evict oldest entries at the bound while retaining the same answer', () => {
  clearCache()
  const version = parse('1.0.0')
  expect(satisfies(version, '>=0.0.0')).toBe(true)
  for (let patch = 1; patch <= 10_000; patch++) {
    expect(satisfies(version, `>=0.0.${patch}`)).toBe(true)
  }
  const before = cacheStats()
  expect(satisfies(version, '>=0.0.0')).toBe(true)
  expect(cacheStats().hits).toBeGreaterThan(before.hits)
})

test('Maven numeric qualifier segments retain their parsed ordering', () => {
  expect(compare('1.0-alpha.1', '1.0-alpha.2', 'maven')).toBe(-1)
  expect(compare('1.0-alpha.2', '1.0-alpha.1', 'maven')).toBe(1)
})

test.each([
  ['1.0.0-alpha', '1.0.0-beta', -1],
  ['1.0.0-beta', '1.0.0-alpha', 1],
  ['1.0.0-alpha.1', '1.0.0-alpha.2', -1],
  ['1.0.0-alpha.2', '1.0.0-alpha.1', 1],
])('orders NuGet labels %s and %s', (left, right, expected) => {
  expect(compare(left, right, 'nuget')).toBe(expected)
})
