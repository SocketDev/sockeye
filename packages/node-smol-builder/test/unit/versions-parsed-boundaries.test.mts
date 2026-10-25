import { afterEach, expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  clearCache,
  compare,
  parse,
  satisfies,
} from '../../additions/source-patched/lib/internal/socketsecurity/versions.js'
afterEach(clearCache)
test('equal large stable versions use the non-packed comparison path', () => {
  expect(compare(parse('2048.0.0+first'), parse('2048.0.0+second'))).toBe(0)
})
test.each([
  ['1.9.0', '~1', true],
  ['2.0.0', '~1', false],
  ['1.2.9', '~1.2', true],
  ['1.3.0', '~1.2', false],
])(
  'preparsed version %s obeys partial tilde %s',
  (version, range, expected) => {
    expect(satisfies(parse(version), range)).toBe(expected)
  },
)
