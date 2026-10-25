import { beforeEach, expect, test, vi } from 'vitest'
import {
  printSetupResults,
  setupBuildEnvironment,
  setupPythonEnvironment,
} from '../lib/build-env.mts'
const io = vi.hoisted(() => ({
  python: vi.fn(),
  rust: vi.fn(),
  activate: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  error: vi.fn(),
}))
vi.mock(import('../lib/build-env-toolchain.mts'), () => ({
  checkPython: io.python,
  checkRust: io.rust,
}))
vi.mock(import('../lib/build-env-emscripten.mts'), () => ({
  activateEmscriptenSDK: io.activate,
  getEmscriptenVersion: async () => '4.0.0',
}))
vi.mock(import('../lib/version-metadata.mts'), () => ({
  getMinPythonVersion: () => '3.12',
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    info: io.info,
    warn: io.warn,
    fail: io.fail,
    error: io.error,
  }),
}))
beforeEach(() => {
  vi.clearAllMocks()
  io.activate.mockResolvedValue(false)
  io.rust.mockResolvedValue({
    available: false,
    reason: 'Fixture compiler missing',
  })
  io.python.mockResolvedValue({ available: false })
})
test('prints every result message and error with failure guidance', () => {
  printSetupResults({
    messages: ['example Python ready'],
    errors: ['example Rust missing'],
    success: false,
  })
  expect(io.info).toHaveBeenCalledWith('example Python ready')
  expect(io.warn).toHaveBeenCalledWith('example Rust missing')
  expect(io.fail).toHaveBeenCalledOnce()
})
test('empty successful results emit no output', () => {
  printSetupResults({ messages: [], errors: [], success: true })
  expect(io.info).not.toHaveBeenCalled()
  expect(io.warn).not.toHaveBeenCalled()
  expect(io.error).not.toHaveBeenCalled()
  expect(io.fail).not.toHaveBeenCalled()
})
test.each([false, true])(
  'missing SDK and Rust report appropriate automatic setup=%s guidance',
  async autoSetup => {
    const result = await setupBuildEnvironment({
      emscripten: true,
      rust: true,
      autoSetup,
    })
    expect(result.success).toBe(false)
    expect(result.errors.some(value => value.includes('--rust'))).toBe(
      autoSetup,
    )
    expect(result.errors.some(value => value.includes('--emscripten'))).toBe(
      autoSetup,
    )
    expect(
      result.errors.some(value => value.includes('https://emscripten.org/')),
    ).toBe(!autoSetup)
  },
)
test('Rust-specific repair takes precedence over generic setup', async () => {
  io.rust.mockResolvedValue({
    available: false,
    reason: 'Fixture target missing',
    fix: 'rustup target add wasm32-unknown-unknown',
  })
  const result = await setupBuildEnvironment({ rust: true })
  expect(result.errors).toContain(
    '  Fix: rustup target add wasm32-unknown-unknown',
  )
  expect(result.errors.some(value => value.includes('--rust'))).toBe(false)
})
test.each([false, true])(
  'missing Python guidance respects automatic setup=%s',
  async autoSetup => {
    const result = {
      success: true,
      errors: [] as string[],
      messages: [] as string[],
    }
    await setupPythonEnvironment(result, { autoSetup })
    expect(result.success).toBe(false)
    expect(result.errors.some(value => value.includes('--python'))).toBe(
      autoSetup,
    )
  },
)
