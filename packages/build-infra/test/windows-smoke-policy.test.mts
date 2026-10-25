import { beforeEach, expect, test, vi } from 'vitest'
import {
  checkSpawnResult,
  reportBinaryTestError,
  runNativeBinaryTests,
} from '../lib/binary-smoke-test.mts'

const io = vi.hoisted(() => ({ verify: vi.fn(), spawn: vi.fn() }))
vi.mock(import('node:os'), async original => {
  const actual = await original()
  return {
    ...actual,
    default: { ...actual.default, platform: () => 'win32' },
    platform: () => 'win32',
  }
})
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), isWin32: () => true }),
)
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/binary-verify.mts'), async original => ({
  ...(await original()),
  staticVerifyBinary: io.verify,
}))
vi.mock(import('../lib/smoke-test-strategy.mts'), async original => ({
  ...(await original()),
  isSelfExtractingBinary: () => true,
}))

beforeEach(() => vi.resetAllMocks())

test('accepts the known Windows exit anomaly only when output exists', () => {
  const code = 3_221_226_505
  expect(
    checkSpawnResult({ code, stdout: 'v24.0.0' }, 'version', 'example.exe'),
  ).toBe(true)
  expect(checkSpawnResult({ code, stdout: '' }, 'version', 'example.exe')).toBe(
    false,
  )
  const error = Object.assign(new Error('Fixture Windows exit anomaly'), {
    code,
    signal: undefined,
    stdout: 'v24.0.0',
    stderr: '',
  })
  expect(
    reportBinaryTestError({
      error,
      execPath: 'example.exe',
      args: ['--version'],
      testName: 'version',
    }),
  ).toBe(true)
})

test.each([true, false])(
  'returns static validation verdict %s for a Windows extracting stub',
  async valid => {
    io.verify.mockResolvedValue(valid)
    await expect(
      runNativeBinaryTests('example.exe', { arch: 'x64', platform: 'win32' }),
    ).resolves.toBe(valid)
    expect(io.verify).toHaveBeenCalledWith('example.exe', {
      arch: 'x64',
      platform: 'win32',
    })
    expect(io.spawn).not.toHaveBeenCalled()
  },
)
