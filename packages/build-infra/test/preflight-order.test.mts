import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  checkCompiler,
  checkDiskSpace,
  checkPythonVersion,
} from '../lib/build-operations.mts'
import { getMinPythonVersion } from '../lib/version-metadata.mts'
import { runPreflightChecks } from '../lib/preflight-checks.mts'

vi.mock(import('../lib/build-operations.mts'), () => ({
  checkCompiler: vi.fn(),
  checkDiskSpace: vi.fn(),
  checkPythonVersion: vi.fn(),
}))
vi.mock(import('../lib/version-metadata.mts'), () => ({
  getMinPythonVersion: vi.fn(),
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getMinPythonVersion).mockReturnValue('3.12')
  vi.mocked(checkDiskSpace).mockResolvedValue({
    sufficient: false,
    availableGB: 1,
    requiredGB: 5,
  })
  vi.mocked(checkCompiler).mockResolvedValue({ available: false })
  vi.mocked(checkPythonVersion).mockResolvedValue({
    available: false,
    sufficient: false,
    version: undefined,
  })
})

describe('build preflight ordering', () => {
  test('stops after the first failure by default', async () => {
    const result = await runPreflightChecks({
      compiler: true,
      python: true,
      quiet: true,
    })
    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(vi.mocked(checkCompiler).mock.calls).toHaveLength(0)
    expect(vi.mocked(checkPythonVersion).mock.calls).toHaveLength(0)
  })

  test('collects all failures in disk, compiler, Python order', async () => {
    const result = await runPreflightChecks({
      compiler: true,
      compilers: ['clang', 'gcc'],
      python: true,
      failFast: false,
      quiet: true,
    })
    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(3)
    expect(vi.mocked(checkDiskSpace).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(checkCompiler).mock.invocationCallOrder[0]!,
    )
    expect(vi.mocked(checkCompiler).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(checkPythonVersion).mock.invocationCallOrder[0]!,
    )
    expect(vi.mocked(checkCompiler).mock.calls).toEqual([[['clang', 'gcc']]])
    expect(vi.mocked(checkPythonVersion).mock.calls).toEqual([['3.12']])
  })

  test('skips disabled checks and uses an explicit Python minimum', async () => {
    vi.mocked(checkPythonVersion).mockResolvedValue({
      available: true,
      sufficient: true,
      version: '3.11',
    })
    expect(
      await runPreflightChecks({
        disk: false,
        python: true,
        pythonVersion: '3.11',
        quiet: true,
      }),
    ).toEqual({ passed: true, failures: [] })
    expect(vi.mocked(checkDiskSpace).mock.calls).toHaveLength(0)
    expect(vi.mocked(checkCompiler).mock.calls).toHaveLength(0)
    expect(vi.mocked(getMinPythonVersion).mock.calls).toHaveLength(0)
    expect(vi.mocked(checkPythonVersion).mock.calls).toEqual([['3.11']])
  })

  test('still resolves the configured Python minimum with all checks disabled', async () => {
    expect(await runPreflightChecks({ disk: false, quiet: true })).toEqual({
      passed: true,
      failures: [],
    })
    expect(vi.mocked(getMinPythonVersion).mock.calls).toHaveLength(1)
  })
})
