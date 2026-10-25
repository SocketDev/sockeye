import { expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import { semver } from '../../additions/source-patched/lib/internal/socketsecurity/http/version_subset.js'
test.each([
  ['1.2.3', '>=1.2.3', true],
  ['1.2.2', '>=1.2.3', false],
  ['1.1.9', '>=1.2.3', false],
  ['1.3.0', '>=1.2.3', true],
  ['0.9.9', '>=1.2.3', false],
])('subset lower bound compares %s with %s', (version, range, expected) => {
  expect(semver.satisfies(version, range)).toBe(expected)
})
