import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import {
  activateEmscriptenSDK,
  findEmscriptenSDK,
  getEmscriptenVersion,
  resolveEmscriptenCompilerPath,
} from '../lib/build-env-emscripten.mts'
const io = vi.hoisted(() => ({
  platform: 'linux',
  exists: vi.fn(),
  command: vi.fn(),
  output: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(import('../lib/build-env-toolchain.mts'), () => ({
  commandExists: io.command,
  getCommandOutput: io.output,
  getPlatform: () => io.platform,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.platform = 'linux'
  io.exists.mockReturnValue(false)
  io.command.mockResolvedValue(false)
  io.output.mockResolvedValue('')
  for (const name of ['EMSDK', 'EMSCRIPTEN', 'EM_CACHE', 'EXAMPLE_UNRELATED']) {
    vi.stubEnv(name, undefined)
  }
  vi.stubEnv('PATH', process.env['PATH'])
})
afterEach(() => vi.unstubAllEnvs())

test('activation refuses absent SDKs and missing environment scripts', async () => {
  expect(await activateEmscriptenSDK()).toBe(false)
  vi.stubEnv('EMSDK', '/example/sdk')
  io.exists.mockImplementation(value => value === '/example/sdk')
  expect(await activateEmscriptenSDK()).toBe(false)
  io.platform = 'win32'
  expect(await activateEmscriptenSDK()).toBe(false)
  expect(io.spawn).not.toHaveBeenCalled()
})

test.each(['linux', 'win32'])(
  'activates SDK on %s and imports only selected variables',
  async platform => {
    io.platform = platform
    vi.stubEnv('EMSDK', '/example/sdk')
    io.exists.mockReturnValue(true)
    io.command.mockResolvedValue(true)
    io.spawn.mockResolvedValue({
      code: 0,
      stdout:
        'EMSDK=/example/active\r\nEM_CACHE= /example/cache \r\nPATH=/example/bin\r\nEXAMPLE_UNRELATED=ignored\r\ninvalid',
      stderr: '',
    })
    expect(await activateEmscriptenSDK()).toBe(true)
    expect(process.env['EMSDK']).toBe('/example/active')
    expect(process.env['EM_CACHE']).toBe('/example/cache')
    expect(process.env['PATH']).toBe('/example/bin')
    expect(process.env['EXAMPLE_UNRELATED']).toBeUndefined()
    expect(io.spawn.mock.calls[0]?.[0]).toBe(
      platform === 'win32' ? 'cmd' : 'bash',
    )
    expect(io.command).toHaveBeenCalledWith('emcc')
  },
)

test('activation refuses unavailable compilers and rejected environment commands', async () => {
  vi.stubEnv('EMSDK', '/example/sdk')
  io.exists.mockReturnValue(true)
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  expect(await activateEmscriptenSDK()).toBe(false)
  io.spawn.mockRejectedValue(
    Object.assign(new Error('fixture launch failed'), { code: 'ENOENT' }),
  )
  expect(await activateEmscriptenSDK()).toBe(false)
})

test('Homebrew activation selects libexec and verifies the compiler', async () => {
  io.command.mockResolvedValue(true)
  io.output.mockResolvedValue('/example/Cellar/emscripten/4.0.0/bin/emcc')
  io.exists.mockImplementation(
    value => typeof value === 'string' && value.endsWith('/Emscripten.cmake'),
  )
  expect(await activateEmscriptenSDK()).toBe(true)
  expect(process.env['EMSDK']).toBe('/example/Cellar/emscripten/4.0.0')
  expect(process.env['EMSCRIPTEN']).toBe(
    '/example/Cellar/emscripten/4.0.0/libexec',
  )
  expect(io.spawn).not.toHaveBeenCalled()
})

test('searches known SDK locations after compiler discovery fails', async () => {
  io.command.mockResolvedValue(true)
  io.output.mockRejectedValue(
    Object.assign(new Error('fixture discovery failed'), { code: 'ENOENT' }),
  )
  io.exists.mockImplementation(
    value => typeof value === 'string' && value.endsWith('/emsdk'),
  )
  expect(await findEmscriptenSDK()).toEqual({
    path: expect.any(String),
    type: 'emsdk',
  })
})

test('version detection handles missing tools, unrecognized output and execution failure', async () => {
  expect(await getEmscriptenVersion()).toBeUndefined()
  io.command.mockResolvedValue(true)
  io.output.mockResolvedValue(
    'emcc (Emscripten gcc/clang-like replacement) 4.0.7',
  )
  expect(await getEmscriptenVersion()).toBe('4.0.7')
  io.output.mockResolvedValue('unrecognized compiler')
  expect(await getEmscriptenVersion()).toBeUndefined()
  io.output.mockRejectedValue(
    Object.assign(new Error('fixture compiler failure'), { code: 1 }),
  )
  expect(await getEmscriptenVersion()).toBeUndefined()
})

test('compiler resolution uses Windows discovery without readlink', async () => {
  io.platform = 'win32'
  io.output.mockResolvedValue('C:\\example\\emcc.bat')
  expect(await resolveEmscriptenCompilerPath()).toBe('C:/example/emcc.bat')
  expect(io.output).toHaveBeenCalledExactlyOnceWith('where', ['emcc'])
})

test('compiler resolution falls back from GNU readlink and retains the original path if both fail', async () => {
  io.exists.mockReturnValue(true)
  io.output
    .mockResolvedValueOnce('/example/bin/emcc')
    .mockRejectedValueOnce(new Error('unsupported flag'))
    .mockResolvedValueOnce('/example/sdk/emcc')
  expect(await resolveEmscriptenCompilerPath()).toBe('/example/sdk/emcc')
  expect(io.output).toHaveBeenLastCalledWith('readlink', ['/example/bin/emcc'])
  io.output
    .mockResolvedValueOnce('/example/bin/emcc')
    .mockRejectedValueOnce(new Error('missing readlink'))
    .mockRejectedValueOnce(new Error('missing readlink'))
  expect(await resolveEmscriptenCompilerPath()).toBe('/example/bin/emcc')
  io.output.mockResolvedValueOnce('/example/bin/emcc').mockResolvedValueOnce('')
  expect(await resolveEmscriptenCompilerPath()).toBe('/example/bin/emcc')
  io.output.mockResolvedValueOnce('')
  expect(await resolveEmscriptenCompilerPath()).toBe('')
})
