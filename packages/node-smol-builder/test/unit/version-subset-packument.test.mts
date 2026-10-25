import { expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  getSubsetStats,
  semver,
  subsetPackument,
} from '../../additions/source-patched/lib/internal/socketsecurity/http/version_subset.js'

const packument = Object.freeze({
  name: 'example-module',
  'dist-tags': Object.freeze({ latest: '2.0.0' }),
  versions: Object.freeze({
    '1.0.0': Object.freeze({
      version: '1.0.0',
      description: 'example release '.repeat(20),
    }),
    '1.1.0': Object.freeze({
      version: '1.1.0',
      description: 'example release '.repeat(20),
    }),
    '2.0.0': Object.freeze({
      version: '2.0.0',
      description: 'example release '.repeat(20),
    }),
  }),
})

test.each([undefined, '', '*', 'latest'])(
  'unrestricted range %s preserves original identity',
  range => {
    expect(subsetPackument(packument, range)).toBe(packument)
  },
)

test('missing inventories and unmatched ranges preserve caller data', () => {
  expect(subsetPackument(undefined, '^1.0.0')).toBeUndefined()
  const missing = { name: 'example-module' }
  expect(subsetPackument(missing, '^1.0.0')).toBe(missing)
  expect(subsetPackument(packument, '^3.0.0')).toBe(packument)
})

test('subset retains metadata and selected manifest references without mutating inputs', () => {
  const subset = subsetPackument(packument, '^1.0.0')
  expect(subset).toMatchObject({
    name: 'example-module',
    _subsetted: true,
    _matched_count: 2,
    _original_count: 3,
    _range: '^1.0.0',
  })
  expect(Object.keys(subset.versions)).toEqual(['1.0.0', '1.1.0'])
  expect(subset.versions['1.0.0']).toBe(packument.versions['1.0.0'])
  expect(subset['dist-tags']).toBe(packument['dist-tags'])
  expect(Object.keys(packument.versions)).toHaveLength(3)
  const stats = getSubsetStats(packument, subset)
  expect(stats.original_count).toBe(3)
  expect(stats.subset_count).toBe(2)
  expect(stats.original_size).toBe(JSON.stringify(packument).length)
  expect(stats.subset_size).toBe(JSON.stringify(subset).length)
  expect(stats.bandwidth_saved).toBe(stats.original_size - stats.subset_size)
  expect(Number(stats.reduction_percent)).toBeGreaterThan(0)
})

test('statistics tolerate objects without inventories', () => {
  expect(getSubsetStats({}, {})).toEqual({
    original_count: 0,
    subset_count: 0,
    original_size: 2,
    subset_size: 2,
    bandwidth_saved: 0,
    reduction_percent: '0.00',
  })
})

test.each(['>', '>=', '<', '<=', '~', '^'])(
  'invalid %s comparators fail closed',
  operator => {
    expect(semver.satisfies('1.2.3', `${operator}invalid`)).toBe(false)
  },
)

test.each([
  ['2.0.0', '>1.9.9', true],
  ['1.3.0', '>1.2.9', true],
  ['1.2.4', '>1.2.3', true],
  ['1.2.3', '>1.2.3', false],
  ['1.0.0', '<=2.0.0', true],
  ['1.1.9', '<=1.2.0', true],
  ['1.2.3', '<=1.2.3', true],
  ['1.2.4', '<=1.2.3', false],
  ['1.2.3-beta', '^1.2.3-alpha', true],
  ['1.2.3-beta', '^1.2.4-alpha', false],
  ['1.2.3-beta', '~1.3.3-alpha', false],
  ['1.2.3-beta', '>2.2.3-alpha', false],
  ['1.2.3', '=invalid', false],
])('version %s matches %s as %s', (version, range, expected) => {
  expect(semver.satisfies(version, range)).toBe(expected)
})
