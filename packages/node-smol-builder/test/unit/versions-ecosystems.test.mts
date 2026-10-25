import { afterEach, expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  cacheStats,
  clearCache,
  compare,
  inc,
  parse,
  satisfies,
  tryParse,
  valid,
} from '../../additions/source-patched/lib/internal/socketsecurity/versions.js'

afterEach(clearCache)

test.each([
  ['nuget', '1', { major: 1, minor: 0, patch: 0, revision: 0 }],
  [
    'nuget',
    '1.2.3.4-RC.2+build',
    {
      major: 1,
      minor: 2,
      patch: 3,
      revision: 4,
      prerelease: ['rc', 2],
      buildMetadata: 'build',
    },
  ],
  ['gem', '1.2.3', { major: 1, minor: 2, patch: 3, segments: [1, 2, 3] }],
  [
    'gem',
    '1.0-beta2',
    { major: 1, minor: 0, patch: 0, segments: [1, 0, 'pre', 'beta', 2] },
  ],
  [
    'pypi',
    '1.2a1.post2.dev3+local; python_version >= "3"',
    { major: 1, minor: 2, hasPost: true, postNum: 2, hasDev: true, devNum: 3 },
  ],
  ['pypi', '1.2.post', { hasPost: true, postNum: 0 }],
  ['pypi', '1.2.dev', { hasDev: true, devNum: 0 }],
  ['unknown', '1.2.3', { major: 1, minor: 2, patch: 3 }],
])(
  'parses %s %s with ecosystem-specific fields',
  (ecosystem, version, expected) => {
    expect(parse(version, ecosystem)).toMatchObject(expected)
    expect(Object.isFrozen(parse(version, ecosystem))).toBe(true)
  },
)

test.each([
  ['nuget', '1.0.0', '2.0.0'],
  ['nuget', '1.1.0', '1.2.0'],
  ['nuget', '1.0.1', '1.0.2'],
  ['nuget', '1.0.0.1', '1.0.0.2'],
  ['nuget', '1.0.0-alpha', '1.0.0'],
  ['nuget', '1.0.0-1', '1.0.0-alpha'],
  ['nuget', '1.0.0-alpha.1', '1.0.0-alpha.2'],
  ['nuget', '1.0.0-alpha', '1.0.0-beta'],
  ['gem', '1.0.0.alpha', '1.0.0'],
  ['gem', '1.0.a', '1.0.b'],
  ['gem', '1.2.3', '1.2.4'],
  ['gem', '1.a1', '1.a2'],
  ['pypi', '1.0.dev1', '1.0.dev2'],
  ['pypi', '1.0.dev2', '1.0a1'],
  ['pypi', '1.0a1', '1.0b1'],
  ['pypi', '1.0rc1', '1.0'],
  ['pypi', '1.0', '1.0.post1'],
  ['pypi', '1.0.post1', '1.0.post2'],
  ['pypi', '1!1.0', '2!1.0'],
  ['pypi', '1!9.9.9', '2!1.0.0'],
  ['npm', '999999.1.1-alpha', '999999.1.2-alpha'],
  ['npm', '999999.1.1-alpha', '999999.2.1-alpha'],
  ['npm', '999999.1.1-alpha', '1000000.1.1-alpha'],
])(
  'orders %s versions %s before %s in both directions',
  (ecosystem, lower, higher) => {
    expect(compare(lower, higher, ecosystem)).toBe(-1)
    expect(compare(higher, lower, ecosystem)).toBe(1)
  },
)

test.each([
  ['nuget', '1.0.0-ALPHA.1', '1.0.0-alpha.1'],
  ['nuget', '1.0.0', '1.0.0.0'],
  ['gem', '1.0.0', '1.0'],
  ['gem', '1.0.a', '1.a'],
  ['pypi', '1.0.dev1', '1.0.dev1+local'],
  ['pypi', '1.0.post1', '1.0.post1+local'],
  ['pypi', '1.0rc1', '1.0rc1+local'],
])('compares equivalent %s versions %s and %s', (ecosystem, left, right) => {
  expect(compare(left, right, ecosystem)).toBe(0)
  expect(compare(right, left, ecosystem)).toBe(0)
})

test('invalid PyPI releases fail without producing cache entries', () => {
  clearCache()
  expect(() => parse('invalid', 'pypi')).toThrow()
  expect(tryParse('invalid', 'pypi')).toBeUndefined()
  expect(valid('invalid', 'pypi')).toBeUndefined()
  expect(cacheStats().size).toBe(0)
})

test('cache records misses, reuses parsed objects, and resets all counters', () => {
  clearCache()
  expect(cacheStats()).toEqual({ size: 0, hits: 0, misses: 0, hitRate: 0 })
  const first = parse('1.2.3')
  expect(parse('1.2.3')).toBe(first)
  expect(cacheStats()).toEqual({ size: 1, hits: 1, misses: 1, hitRate: 0.5 })
  expect(parse('1.2.3', 'nuget')).not.toBe(first)
  clearCache()
  expect(cacheStats()).toEqual({ size: 0, hits: 0, misses: 0, hitRate: 0 })
})

test('prerelease increments preserve labels and append a numeric identifier', () => {
  expect(inc('1.2.3-beta', 'prerelease')).toBe('1.2.3-beta.0')
  expect(inc('1.2.3-beta.9', 'prerelease')).toBe('1.2.3-beta.10')
})

test.each([
  ['1.5.0', '1 - 2', true],
  ['3.0.0', '1 - 2', false],
  ['2.3.9', '1 - 2.3', true],
  ['2.4.0', '1 - 2.3', false],
  ['1.0.0', 'garbage - 2', false],
  ['1.0.0', '1 - garbage', false],
  ['1.0.0', '>=garbage', false],
  ['1.0.0', '^garbage', false],
  ['1.0.0', '~garbage', false],
  ['1.0.0', 'x', true],
  ['1.0.0', 'X', true],
  ['1.2.3-beta', 'latest', false],
])('range %s in %s returns %s', (version, range, expected) => {
  expect(satisfies(parse(version), range)).toBe(expected)
})
