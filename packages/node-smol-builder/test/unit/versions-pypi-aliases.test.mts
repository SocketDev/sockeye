import { afterEach, expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  clearCache,
  compare,
  parse,
} from '../../additions/source-patched/lib/internal/socketsecurity/versions.js'
afterEach(clearCache)
test.each([
  ['alpha', 'a'],
  ['beta', 'b'],
  ['preview', 'rc'],
  ['pre', 'rc'],
  ['c', 'rc'],
])(
  'PyPI %s spelling preserves the prerelease number of %s',
  (alias, canonical) => {
    expect(compare(`1.0${alias}2`, `1.0${canonical}2`, 'pypi')).toBe(0)
    expect(compare(`1.0${alias}2`, `1.0${canonical}1`, 'pypi')).toBe(1)
    expect(parse(`1.0${alias}2`, 'pypi').prerelease[1]).toBe(2)
  },
)
