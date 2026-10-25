import { beforeEach, expect, test, vi } from 'vitest'
import { setupBuildEnvironment } from '../lib/build-env.mts'
import { checkPython, checkRust } from '../lib/build-env-toolchain.mts'
import { activateEmscriptenSDK } from '../lib/build-env-emscripten.mts'

vi.mock(import('../lib/build-env-toolchain.mts'), () => ({
  checkPython: vi.fn(),
  checkRust: vi.fn(),
}))
vi.mock(import('../lib/build-env-emscripten.mts'), () => ({
  activateEmscriptenSDK: vi.fn(),
  getEmscriptenVersion: async () => '3.1.0',
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkPython).mockResolvedValue({
    available: true,
    meetsRequirement: true,
    version: '3.12.0',
  })
  vi.mocked(checkRust).mockResolvedValue({ available: true, version: '1.90.0' })
  vi.mocked(activateEmscriptenSDK).mockResolvedValue(true)
})

test('does not probe toolchains that were not requested', async () => {
  expect(await setupBuildEnvironment()).toEqual({
    success: true,
    errors: [],
    messages: [],
  })
  expect(checkPython).not.toHaveBeenCalled()
  expect(checkRust).not.toHaveBeenCalled()
  expect(activateEmscriptenSDK).not.toHaveBeenCalled()
})

test('reports each enabled available toolchain', async () => {
  const result = await setupBuildEnvironment({
    emscripten: true,
    python: true,
    rust: true,
  })
  expect(result.success).toBe(true)
  expect(result.messages).toHaveLength(3)
  expect(result.errors).toEqual([])
})

test.each([false, true])(
  'reports an old Python interpreter with autoSetup=%s',
  async autoSetup => {
    vi.mocked(checkPython).mockResolvedValue({
      available: true,
      meetsRequirement: false,
      version: '3.0.0',
    })
    const result = await setupBuildEnvironment({ autoSetup, python: true })
    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(autoSetup ? 2 : 1)
  },
)

test('collects unavailable toolchain failures', async () => {
  vi.mocked(checkPython).mockResolvedValue({ available: false })
  vi.mocked(checkRust).mockResolvedValue({
    available: false,
    reason: 'fixture unavailable',
  })
  vi.mocked(activateEmscriptenSDK).mockResolvedValue(false)
  const result = await setupBuildEnvironment({
    autoSetup: false,
    emscripten: true,
    python: true,
    rust: true,
  })
  expect(result.success).toBe(false)
  expect(result.errors).toHaveLength(4)
  expect(result.messages).toEqual([])
})
