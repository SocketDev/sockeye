import { afterEach, expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  clearCache,
  coerce,
  compare,
  parse,
  satisfies,
  sort,
} from '../../additions/source-patched/lib/internal/socketsecurity/versions.js'

afterEach(clearCache)

test.each([
  ['npm', ['1.0.0-1', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0']],
  ['nuget', ['1.0.0-1', '1.0.0-2', '1.0.0-alpha', '1.0.0-beta', '1.0.0']],
  [
    'pypi',
    ['1.0.dev0', '1.0.dev1', '1.0a0', '1.0a1', '1.0', '1.0.post0', '1.0.post1'],
  ],
  ['gem', ['1.0.alpha', '1.0.beta', '1.0', '1.0.1']],
])(
  'compares %s ordered releases reflexively and in both directions',
  (ecosystem, versions) => {
    for (let left = 0; left < versions.length; left += 1) {
      for (let right = 0; right < versions.length; right += 1) {
        expect(
          Math.sign(compare(versions[left], versions[right], ecosystem)),
        ).toBe(Math.sign(left - right))
      }
    }
    expect(sort(versions.toReversed(), ecosystem)).toEqual(versions)
  },
)

test.each([
  ['alpha', 'maven', 0, 0, 0],
  ['1-preview2', 'maven', 1, 0, 0],
  ['1.2-custom', 'maven', 1, 2, 0],
  ['0!1.2', 'pypi', 1, 2, 0],
  ['1.2.3.4', 'gem', 1, 2, 3],
])(
  'parses ecosystem release components from %s',
  (version, ecosystem, major, minor, patch) => {
    expect(parse(version, ecosystem)).toMatchObject({ major, minor, patch })
  },
)

test.each([
  ['0.9.9', '^1.0.0', false],
  ['0.0.2', '^0.0.3', false],
  ['0.0.3', '^0.0.3', true],
  ['0.0.4', '^0.0.3', false],
  ['0.9.9', '~1', false],
  ['1.1.9', '~1.2', false],
  ['1.2.3', '1.2.4', false],
  ['1.2.3', '1.3.x', false],
  ['1.2.3', '^01.02.03', false],
  ['1.2.3', '~01.02.03', false],
  ['1.2.3', '01.02.03 - 02.03.04', false],
  ['2.3.4', '01.02.03 - 02.03.04', false],
  ['2.3.5', '01.02.03 - 02.03.04', false],
  ['1.2.3', '1.2.3 - garbage', false],
  ['1.2.3-alpha', '>=1.2.3-alpha <1.2.3', true],
  ['1.2.4-alpha', '>=1.2.3-alpha <2.0.0', false],
])('evaluates %s against boundary range %s', (version, range, expected) => {
  expect(satisfies(version, range)).toBe(expected)
})

test('partial wildcard coercion preserves numeric zeros', () => {
  expect(coerce('release 0.0')).toBe('0.0.0')
  expect(coerce('release 12')).toBe('12.0.0')
  expect(satisfies('0.0.9', '^0.0')).toBe(true)
  expect(satisfies('0.1.0', '^0.0')).toBe(false)
})
