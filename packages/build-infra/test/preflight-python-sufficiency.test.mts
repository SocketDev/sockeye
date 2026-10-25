import { beforeEach, expect, test, vi } from 'vitest'
import {
  checkPreflightPython,
  runPreflightChecks,
  runPreflightChecksOrExit,
} from '../lib/preflight-checks.mts'
const io = vi.hoisted(() => ({
  python: vi.fn(),
  compiler: vi.fn(),
  disk: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))
vi.mock(import('../lib/build-operations.mts'), () => ({
  checkPythonVersion: io.python,
  checkCompiler: io.compiler,
  checkDiskSpace: io.disk,
}))
vi.mock(import('../lib/version-metadata.mts'), () => ({
  getMinPythonVersion: () => '3.12',
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: io.error }))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    step: vi.fn(),
    log: vi.fn(),
    success: io.success,
    error: io.error,
  }),
}))
beforeEach(() => {
  vi.clearAllMocks()
  io.python.mockResolvedValue({
    available: true,
    sufficient: true,
    version: '3.12',
  })
  io.compiler.mockResolvedValue({ available: true })
  io.disk.mockResolvedValue({ sufficient: true, availableGB: 10 })
})
test('rejects a present Python interpreter below the minimum', async () => {
  io.python.mockResolvedValue({
    available: true,
    sufficient: false,
    version: '3.11',
  })
  expect(await checkPreflightPython('3.12')).toBeDefined()
  expect(
    (await runPreflightChecks({ disk: false, python: true, quiet: true }))
      .passed,
  ).toBe(false)
})
test('reports a successful enabled check and skips disabled checks', async () => {
  expect(await runPreflightChecks({ disk: false, python: true })).toEqual({
    failures: [],
    passed: true,
  })
  expect(io.disk).not.toHaveBeenCalled()
  expect(io.compiler).not.toHaveBeenCalled()
  expect(io.success).toHaveBeenCalledOnce()
})
test('throwing wrapper reports each collected failure without exiting the process', async () => {
  io.disk.mockResolvedValue({ sufficient: false, availableGB: 1 })
  io.python.mockResolvedValue({
    available: false,
    sufficient: false,
    version: undefined,
  })
  await expect(
    runPreflightChecksOrExit({ python: true, failFast: false }),
  ).rejects.toThrow()
  expect(io.error).toHaveBeenCalledWith('Preflight checks failed')
  expect(
    io.error.mock.calls
      .flat()
      .filter(value => typeof value === 'string' && value.startsWith('  - ')),
  ).toHaveLength(2)
})
