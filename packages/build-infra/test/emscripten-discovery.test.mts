import { existsSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { findEmscriptenSDK } from '../lib/build-env-emscripten.mts'
import { commandExists, getCommandOutput } from '../lib/build-env-toolchain.mts'

vi.mock(import('node:fs'), async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, existsSync: vi.fn(actual.existsSync) }
})
vi.mock(import('../lib/build-env-toolchain.mts'), () => ({
  commandExists: vi.fn(),
  getCommandOutput: vi.fn(),
  getPlatform: () => 'linux',
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('EMSDK', '')
  vi.mocked(existsSync).mockReturnValue(false)
  vi.mocked(commandExists).mockResolvedValue(false)
})
afterEach(() => vi.unstubAllEnvs())

test('prefers an existing explicitly configured SDK', async () => {
  vi.stubEnv('EMSDK', '/example/sdk')
  vi.mocked(existsSync).mockReturnValue(true)
  expect(await findEmscriptenSDK()).toEqual({ path: '/example/sdk', type: 'emsdk' })
  expect(commandExists).not.toHaveBeenCalled()
})

test('resolves an SDK from its compiler executable', async () => {
  vi.mocked(commandExists).mockResolvedValue(true)
  vi.mocked(getCommandOutput).mockResolvedValue('/example/sdk/upstream/emscripten/emcc')
  vi.mocked(existsSync).mockImplementation(value => String(value).endsWith('/emcc') || String(value).endsWith('/emsdk'))
  expect(await findEmscriptenSDK()).toEqual({ path: '/example/sdk', type: 'emsdk' })
})

test('recognizes a Homebrew compiler with its CMake configuration', async () => {
  vi.mocked(commandExists).mockResolvedValue(true)
  vi.mocked(getCommandOutput).mockResolvedValue('/example/Cellar/emscripten/3.1.0/bin/emcc')
  vi.mocked(existsSync).mockImplementation(value => String(value).endsWith('/emcc') || String(value).endsWith('/Emscripten.cmake'))
  expect(await findEmscriptenSDK()).toEqual({ path: '/example/Cellar/emscripten/3.1.0', type: 'homebrew' })
})

test('returns no SDK when no candidate exists', async () => {
  expect(await findEmscriptenSDK()).toBeUndefined()
})
