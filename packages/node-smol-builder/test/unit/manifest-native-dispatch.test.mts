import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import '../helpers/primordials-shim.mts'
import { parseLockfile } from '../../additions/source-patched/lib/internal/socketsecurity/manifest.js'
const binding = vi.hoisted(() => {
  const native = { parseLockfile: vi.fn() }
  vi.stubGlobal('internalBinding', (name: string) => {
    if (name !== 'smol_manifest_native') {
      throw new Error('unexpected fixture binding')
    }
    return native
  })
  return native
})
beforeEach(() => vi.resetAllMocks())
afterAll(() => vi.unstubAllGlobals())

test.each([
  {
    ecosystem: 'npm',
    format: 'npm',
    eco: 0,
    fmt: 0,
    source: '{"lockfileVersion":3,"packages":{}}',
  },
  {
    ecosystem: 'npm',
    format: 'pnpm',
    eco: 0,
    fmt: 1,
    source: "lockfileVersion: '9.0'\npackages: {}",
  },
  {
    ecosystem: 'npm',
    format: 'yarn',
    eco: 0,
    fmt: 2,
    source: '# yarn lockfile v1\n',
  },
  {
    ecosystem: 'cargo',
    format: 'cargo',
    eco: 1,
    fmt: 3,
    source: 'version = 3\n',
  },
  { ecosystem: 'pypi', format: 'uv', eco: 2, fmt: 4, source: 'version = 1\n' },
])(
  'dispatches $ecosystem/$format with exact native format identifiers',
  ({ ecosystem, format, eco, fmt, source }) => {
    const parsed = Object.freeze({
      type: 'lockfile',
      ecosystem,
      packages: Object.freeze([]),
    })
    binding.parseLockfile.mockReturnValue(parsed)
    expect(parseLockfile(source, ecosystem, format)).toBe(parsed)
    expect(binding.parseLockfile).toHaveBeenCalledExactlyOnceWith(
      source,
      eco,
      fmt,
    )
  },
)

test('preserves native parser failures rather than accepting a fallback inventory', () => {
  const failure = Object.assign(new Error('example rejected lockfile'), {
    code: 'ERR_INVALID_FORMAT',
  })
  binding.parseLockfile.mockImplementation(() => {
    throw failure
  })
  expect(() => parseLockfile('invalid', 'npm', 'npm')).toThrow(failure)
})
