import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  ensureEmscriptenEnvironment,
  getDefaultEmsdkPath,
} from '../lib/emscripten-environment.mts'
import { findEmscriptenSDK } from '../lib/build-env-emscripten.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  which: vi.fn(),
  command: vi.fn(),
  output: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async original => ({ ...(await original()), whichSync: io.which }),
)
vi.mock(import('../lib/build-env-toolchain.mts'), () => ({
  commandExists: io.command,
  getCommandOutput: io.output,
  getPlatform: () => 'linux',
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('EMSDK', '')
  vi.stubEnv('EMSCRIPTEN', '')
  io.exists.mockReturnValue(false)
  io.command.mockResolvedValue(true)
  io.output.mockResolvedValue('')
})
afterEach(() => vi.unstubAllEnvs())

test('default SDK discovery tolerates a compiler removed after PATH lookup', () => {
  io.which.mockReturnValue('/example/sdk/upstream/emscripten/emcc')
  ensureEmscriptenEnvironment(undefined)
  expect(io.exists).toHaveBeenCalledWith(`${getDefaultEmsdkPath()}/emsdk`)
  expect(process.env['EMSCRIPTEN']).toBe('/example/sdk/upstream/emscripten')
  expect(process.env['EMSDK']).toBe('')
})

test('an empty compiler lookup falls through to SDK search without fabricating a location', async () => {
  expect(await findEmscriptenSDK()).toBeUndefined()
  expect(io.output).toHaveBeenCalledWith('which', ['emcc'])
})

test.each([
  '/example/Cellar/emscripten/3.1.0/bin/emcc',
  '/example/sdk/upstream/emscripten/emcc',
])(
  'a compiler at %s without SDK metadata is not accepted as an SDK',
  async compiler => {
    io.output.mockResolvedValue(compiler)
    expect(await findEmscriptenSDK()).toBeUndefined()
    expect(io.exists).toHaveBeenCalledWith(expect.stringContaining('emsdk'))
  },
)
