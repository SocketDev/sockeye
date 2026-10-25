import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  checkEmsdkInstalled,
  ensureEmscriptenEnvironment,
  getEmsdkSpawnEnv,
  parseEmsdkEnvironment,
} from '../lib/emscripten-environment.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  realpath: vi.fn(),
  which: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
  realpathSync: io.realpath,
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: io.which,
}))
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  vi.clearAllMocks()
  for (const name of ['EMSDK', 'EMSCRIPTEN', 'EMSDK_PYTHON', 'SSL_CERT_FILE']) {
    vi.stubEnv(name, undefined)
  }
  io.exists.mockReturnValue(false)
  io.which.mockReturnValue(undefined)
  io.realpath.mockReturnValue('/example/sdk/upstream/emscripten/emcc')
})
afterEach(() => {
  vi.unstubAllEnvs()
  Object.defineProperty(process, 'platform', originalPlatform)
})
test('preserves explicit EMSCRIPTEN and does not probe emcc', () => {
  vi.stubEnv('EMSCRIPTEN', '/example/custom')
  ensureEmscriptenEnvironment('/example/sdk')
  expect(process.env['EMSCRIPTEN']).toBe('/example/custom')
  expect(io.which).not.toHaveBeenCalled()
})
test('missing SDK and compiler do not invent environment locations', () => {
  ensureEmscriptenEnvironment('/example/sdk')
  expect(process.env['EMSDK']).toBeUndefined()
  expect(process.env['EMSCRIPTEN']).toBeUndefined()
})
test('resolves a symlinked emcc and finds the surrounding SDK', () => {
  io.which.mockReturnValue('/example/bin/emcc')
  io.exists.mockImplementation(
    filename =>
      filename === '/example/bin/emcc' || filename === '/example/sdk/emsdk',
  )
  ensureEmscriptenEnvironment('/example/absent')
  expect(io.realpath).toHaveBeenCalledWith('/example/bin/emcc')
  expect(process.env['EMSCRIPTEN']).toBe('/example/sdk/upstream/emscripten')
  expect(process.env['EMSDK']).toBe('/example/sdk')
})
test('recognizes Windows SDK sentinel', () => {
  io.exists.mockImplementation(
    filename => filename === '/example/sdk/emsdk.bat',
  )
  expect(checkEmsdkInstalled('/example/sdk')).toBe(true)
})
test.each([false, true])(
  'Linux child environment respects existing overrides=%s',
  existing => {
    Object.defineProperty(process, 'platform', {
      ...originalPlatform,
      value: 'linux',
    })
    io.exists.mockReturnValue(true)
    if (existing) {
      vi.stubEnv('EMSDK_PYTHON', '/example/python')
      vi.stubEnv('SSL_CERT_FILE', '/example/ca.pem')
    }
    const result = getEmsdkSpawnEnv()
    expect(result['EMSDK_PYTHON']).toBe(
      existing ? '/example/python' : '/usr/bin/python3',
    )
    expect(result['SSL_CERT_FILE']).toBe(
      existing ? '/example/ca.pem' : '/etc/ssl/certs/ca-certificates.crt',
    )
    expect(process.env['EMSDK_PYTHON']).toBe(
      existing ? '/example/python' : undefined,
    )
  },
)
test('Linux omits unavailable system fallbacks', () => {
  Object.defineProperty(process, 'platform', {
    ...originalPlatform,
    value: 'linux',
  })
  expect(getEmsdkSpawnEnv()['EMSDK_PYTHON']).toBeUndefined()
  expect(getEmsdkSpawnEnv()['SSL_CERT_FILE']).toBeUndefined()
})
test('parses only SDK variables and preserves values containing equals signs', () => {
  expect(
    parseEmsdkEnvironment(
      'PATH=/example/bin\r\nEM_CONFIG=setting=value\r\nEMSDK=/example/actual\nOTHER=private\ninvalid line',
      '/example/sdk',
    ),
  ).toEqual({
    PATH: '/example/bin',
    EM_CONFIG: 'setting=value',
    EMSDK: '/example/actual',
    EMSCRIPTEN: '/example/sdk/upstream/emscripten',
  })
})
