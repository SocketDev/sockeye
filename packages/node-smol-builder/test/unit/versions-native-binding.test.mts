import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  compare,
  parse,
  satisfies,
  valid,
} from '../../additions/source-patched/lib/internal/socketsecurity/versions.js'

const binding = vi.hoisted(() => {
  const native = { compare: vi.fn(), satisfies: vi.fn(), valid: vi.fn() }
  vi.stubGlobal('internalBinding', (name: string) => {
    if (name !== 'smol_versions_native') {
      throw new Error('Unexpected fixture binding')
    }
    return native
  })
  return native
})
beforeEach(() => vi.resetAllMocks())
afterAll(() => vi.unstubAllGlobals())

test('forwards string comparisons to the native binding', () => {
  binding.compare.mockReturnValue(-1)
  expect(compare('1.0.0', '2.0.0')).toBe(-1)
  expect(binding.compare).toHaveBeenCalledWith('1.0.0', '2.0.0')
})

test('falls back to JavaScript error handling after a native parse rejection', () => {
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- native comparison returns null when parsing fails.
  binding.compare.mockReturnValue(null)
  expect(() => compare('invalid', '1.0.0')).toThrow()
  expect(binding.compare).toHaveBeenCalledOnce()
})

test('preparsed versions and other ecosystems bypass the native comparison', () => {
  expect(compare(parse('1.0.0'), parse('2.0.0'))).toBe(-1)
  expect(compare('1.0.0', '2.0.0', 'nuget')).toBe(-1)
  expect(binding.compare).not.toHaveBeenCalled()
})

test.each([true, false])('forwards the native range result %s', result => {
  binding.satisfies.mockReturnValue(result)
  expect(satisfies('1.2.3', '^1.0.0')).toBe(result)
  expect(binding.satisfies).toHaveBeenCalledWith('1.2.3', '^1.0.0', false)
})

test('preparsed versions use JavaScript range evaluation', () => {
  expect(satisfies(parse('1.2.3'), '^1.0.0')).toBe(true)
  expect(binding.satisfies).not.toHaveBeenCalled()
})

test.each([true, false])('preserves native validation result %s', result => {
  binding.valid.mockReturnValue(result)
  expect(valid('1.2.3')).toBe(result ? '1.2.3' : undefined)
  expect(binding.valid).toHaveBeenCalledWith('1.2.3')
})
