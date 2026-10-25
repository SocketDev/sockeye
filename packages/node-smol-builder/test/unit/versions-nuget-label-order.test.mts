import { afterEach, expect, test } from 'vitest'
import '../helpers/primordials-shim.mts'
import {
  clearCache,
  compare,
} from '../../additions/source-patched/lib/internal/socketsecurity/versions.js'
afterEach(clearCache)
test.each([
  ['1.0.0-alpha', '1.0.0-alpha.1', -1],
  ['1.0.0-alpha.1', '1.0.0-alpha', 1],
  ['1.0.0-alpha.1', '1.0.0-alpha.1.2', -1],
  ['1.0.0-alpha.1.2', '1.0.0-alpha.1', 1],
])(
  'NuGet label precedence for %s versus %s follows prefix ordering',
  (left, right, expected) => {
    expect(compare(left, right, 'nuget')).toBe(expected)
  },
)
