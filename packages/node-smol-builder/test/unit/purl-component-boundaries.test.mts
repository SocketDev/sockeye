import { afterEach, expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  clearCache,
  parse,
} from '../../additions/source-patched/lib/internal/socketsecurity/purl.js'

afterEach(clearCache)

test.each([' ', '\t', '\r', '\n'])(
  'trims trailing component whitespace without a leading delimiter %j',
  whitespace => {
    expect(
      parse(`pkg:generic/example${whitespace}@1.0${whitespace}`),
    ).toMatchObject({ name: 'example', version: '1.0' })
  },
)

test('rejects decoded namespace traversal before returning a package', () => {
  expect(() => parse('pkg:generic/%2e%2e/example')).toThrow(TypeError)
})

test('retains an at-prefixed component as a package name', () => {
  expect(parse('pkg:generic/example-namespace/@example-module')).toMatchObject({
    namespace: 'example-namespace',
    name: '@example-module',
    version: undefined,
  })
})

test('rejects an empty name after repeated trailing separators', () => {
  expect(() => parse('pkg:generic/example-namespace///')).toThrow()
})
