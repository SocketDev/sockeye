import { afterEach, expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  build,
  cacheStats,
  clearCache,
  parse,
  parseBatch,
  tryParse,
} from '../../additions/source-patched/lib/internal/socketsecurity/purl.js'

afterEach(clearCache)

test('bounds the PURL cache and evicts the oldest parsed record', () => {
  clearCache()
  expect(cacheStats()).toMatchObject({
    size: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
  })
  const first = parse('pkg:npm/example-module@0.0.0')
  expect(parse('pkg:npm/example-module@0.0.0')).toBe(first)
  for (let patch = 1; patch <= 10_000; patch++) {
    parse(`pkg:npm/example-module@0.0.${patch}`)
  }
  expect(cacheStats()).toMatchObject({ size: 10_000, hits: 1, misses: 10_001 })
  expect(parse('pkg:npm/example-module@0.0.0')).not.toBe(first)
  expect(cacheStats().size).toBe(10_000)
})

test.each([undefined, 42, false])('rejects non-string PURL input %s', value => {
  expect(() => parse(value)).toThrow()
  expect(tryParse(value)).toBeUndefined()
})

test.each([
  'pkg:npm',
  'pkg:npm?arch=x64',
  'pkg:npm#source',
  'pkg:npm/',
  `pkg:npm/${'x'.repeat(4096)}`,
])('rejects missing names and oversized identifiers %s', value => {
  expect(() => parse(value)).toThrow()
})

test.each(['name%00', 'name%7f', 'name%0d%0a'])(
  'rejects decoded control bytes in %s',
  name => {
    expect(() => parse(`pkg:npm/${name}`)).toThrow()
    expect(() => parse(`pkg:npm/example?arch=${name}`)).toThrow()
  },
)

test('handles malformed encoding without losing the literal identifier', () => {
  expect(parse('pkg:generic/example%GG?arch=%ZZ')).toMatchObject({
    name: 'example%GG',
    qualifiers: { arch: '%ZZ' },
  })
})

test('qualifier parsing skips empty pairs and values but rejects empty keys', () => {
  expect(
    parse('pkg:generic/example?&&arch=x64&&empty=   &ignored'),
  ).toMatchObject({ qualifiers: { arch: 'x64' } })
  expect(() => parse('pkg:generic/example?=x64')).toThrow()
  expect(() => parse('pkg:generic/example?   =x64')).toThrow()
})

test.each([' ', '\t', '\r', '\n'])(
  'trims trailing and leading component whitespace %j',
  whitespace => {
    expect(
      parse(
        `pkg:generic/${whitespace}example${whitespace}@${whitespace}1.0${whitespace}`,
      ),
    ).toMatchObject({ name: 'example', version: '1.0' })
  },
)

test('subpath decoding filters dot segments and encodes surviving separators', () => {
  expect(parse('pkg:generic/example#')).toMatchObject({ subpath: undefined })
  expect(parse('pkg:generic/example#/./../')).toMatchObject({
    subpath: undefined,
  })
  const parsed = parse('pkg:generic/example#src//./../some%20file.js')
  expect(parsed.subpath).toBe('src/some file.js')
  expect(build(parsed)).toBe('pkg:generic/example#src/some%20file.js')
})

test('batch parsing retains positional failures and rejects non-array containers', () => {
  const batch = parseBatch([
    'pkg:npm/example@1.0.0',
    'invalid',
    'pkg:generic/other',
  ])
  expect(batch).toHaveLength(3)
  expect(batch[0]).toMatchObject({ name: 'example', version: '1.0.0' })
  expect(batch[1]).toBeUndefined()
  expect(batch[2]).toMatchObject({ name: 'other' })
  expect(() => parseBatch('pkg:npm/example')).toThrow()
})

test.each([undefined, 42, false])(
  'building rejects invalid component container %s',
  options => {
    expect(() => build(options)).toThrow()
  },
)

test('building omits undefined qualifier entries and preserves meaningful scalar values', () => {
  expect(
    build({
      type: 'generic',
      name: 'example',
      qualifiers: { absent: undefined },
    }),
  ).toBe('pkg:generic/example')
  expect(
    build({
      type: 'generic',
      name: 'example',
      qualifiers: { zero: 0, flag: false, absent: undefined },
    }),
  ).toBe('pkg:generic/example?flag=false&zero=0')
})
