import os from 'node:os'
import { afterEach, expect, test, vi } from 'vitest'
import {
  getCCRemapEnv,
  getCCRemapFlagsString,
  getEncodedRustflags,
  getRemapPairs,
  getRustcRemapFlags,
} from '../lib/path-remap-flags.mts'
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
function fixedPaths() {
  vi.spyOn(os, 'homedir').mockReturnValue('/example/user-root')
  vi.spyOn(process, 'cwd').mockReturnValue('/example/user-root/project')
  vi.stubEnv('CARGO_HOME', '/example/user-root/cargo')
}

test('absent Cargo home uses the default directory below the user home', () => {
  fixedPaths()
  vi.stubEnv('CARGO_HOME', undefined)
  expect(getRemapPairs()[0]).toEqual(['/example/user-root/.cargo', '/cargo'])
})
test('compiler environment preserves existing options and applies every path mapping', () => {
  fixedPaths()
  const original = { CFLAGS: ' -O2 ', CXXFLAGS: '-g', UNRELATED: 'preserve' }
  const env = getCCRemapEnv(original)
  expect(Object.keys(env)).toEqual([
    'CFLAGS',
    'CXXFLAGS',
    'CPPFLAGS',
    'EMCC_CFLAGS',
    'EMCC_CXXFLAGS',
    'CGO_CFLAGS',
    'CGO_CXXFLAGS',
  ])
  expect(env.CFLAGS).toBe(
    '-O2 -ffile-prefix-map=/example/user-root/cargo=/cargo -ffile-prefix-map=/example/user-root/project=/build -ffile-prefix-map=/example/user-root=/home',
  )
  expect(env.CPPFLAGS).toBe(getCCRemapFlagsString())
  expect(original).toEqual({
    CFLAGS: ' -O2 ',
    CXXFLAGS: '-g',
    UNRELATED: 'preserve',
  })
})
test('Cargo token encoding preserves spaces inside extra flags', () => {
  fixedPaths()
  expect(
    getEncodedRustflags(['--cfg=feature="example feature"']).split('\u001f'),
  ).toEqual([...getRustcRemapFlags(), '--cfg=feature="example feature"'])
  expect(getEncodedRustflags().split('\u001f')).toEqual(getRustcRemapFlags())
})
test.each(['/example/user-root', '/example/user-root/cargo/registry'])(
  'does not override an existing specific mapping for %s',
  cwd => {
    fixedPaths()
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    expect(getRemapPairs()).toEqual([
      ['/example/user-root/cargo', '/cargo'],
      ['/example/user-root', '/home'],
    ])
  },
)
