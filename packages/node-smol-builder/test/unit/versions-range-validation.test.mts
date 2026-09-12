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
  '1.0a',
  '1.0alpha',
  '1.0b',
  '1.0beta',
  '1.0rc',
  '1.0pre',
  '1.0preview',
])('PyPI omitted prerelease number in %s defaults to zero', version => {
  expect(compare(version, `${version}0`, 'pypi')).toBe(0)
})
test('zero-valued release segments and stable NuGet revision default remain numeric', () => {
  expect(parse('0.0.0.dev', 'pypi')).toMatchObject({
    major: 0,
    minor: 0,
    patch: 0,
    devNum: 0,
  })
  expect(parse('0', 'nuget')).toMatchObject({
    major: 0,
    minor: 0,
    patch: 0,
    revision: 0,
  })
})
test('sorting cached parsed records preserves the original record identities', () => {
  const earlier = parse('1.0.0')
  const later = parse('2.0.0')
  const result = sort([later, earlier])
  expect(result[0]).toBe(earlier)
  expect(result[1]).toBe(later)
  expect(() => sort([undefined])).toThrow()
})
test.each(['>=', '^', '~', 'garbage - 2', '1 - garbage'])(
  'malformed comparator %s fails closed for an already parsed version',
  range => {
    expect(satisfies(parse('1.2.3'), range)).toBe(false)
  },
)
test('oversized partial hyphen ceilings cannot become an unconstrained match', () => {
  const oversized = '9'.repeat(309)
  expect(satisfies(parse('1.2.3'), `1 - ${oversized}`)).toBe(false)
  expect(satisfies(parse('1.2.3'), `1 - 2.${oversized}`)).toBe(false)
})
test('OR alternatives retain a successful valid branch beside malformed input', () => {
  expect(satisfies(parse('1.2.3'), 'garbage || >=1.0.0 <2.0.0')).toBe(true)
  expect(satisfies(parse('1.2.3'), '>=1.0.0 <2.0.0 || garbage')).toBe(true)
  expect(satisfies(parse('2.2.3'), 'garbage || >=1.0.0 <2.0.0')).toBe(false)
})
test('numeric zero is preserved during text coercion', () => {
  expect(coerce('example 0.0.0')).toBe('0.0.0')
  expect(coerce('example 0')).toBe('0.0.0')
})
