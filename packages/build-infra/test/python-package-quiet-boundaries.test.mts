import { beforeEach, expect, test, vi } from 'vitest'
import {
  checkPythonPackageVersion,
  ensureAllPythonPackages,
  ensurePythonPackage,
  installPythonPackage,
  retryPythonVersionMismatch,
} from '../lib/python-installer-ops.mts'
const io = vi.hoisted(() => ({
  spawn: vi.fn(),
  pip: 'example-pip' as string | undefined,
  expected: '1.2.3' as string | undefined,
  spec: vi.fn(),
  retries: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/python-installer.mts'), () => ({
  getPythonCommand: async () => 'example-python',
  getPipCommand: () => io.pip,
  initializeVenv: vi.fn(),
  venvInitialized: true,
}))
vi.mock(import('../lib/python-package-pin.mts'), () => ({
  getExpectedPythonVersion: () => io.expected,
  getPythonInstallSpec: io.spec,
}))
vi.mock(import('../lib/python-pip-retry.mts'), () => ({
  getPythonInstallArgs: () => ['install', 'example-package==1.2.3'],
  runPythonPipRetries: io.retries,
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.pip = 'example-pip'
  io.expected = '1.2.3'
  io.spec.mockReturnValue('example-package==1.2.3')
  io.retries.mockResolvedValue(0)
  io.spawn.mockResolvedValue({ code: 0, stdout: '1.2.3', stderr: '' })
})

test('empty version output is a mismatch, not an installed pinned version', async () => {
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  expect(await checkPythonPackageVersion('example_package', '1.2.3')).toBe(
    false,
  )
})

test('quiet missing pip does not start installation', async () => {
  io.pip = undefined
  expect(await installPythonPackage('example-package', { quiet: true })).toBe(
    false,
  )
  expect(io.retries).not.toHaveBeenCalled()
})

test.each(['failed-exit', 'rejected-launch'])(
  'quiet installation reports %s as unavailable',
  async scenario => {
    if (scenario === 'failed-exit') {
      io.retries.mockResolvedValue(2)
    } else {
      io.retries.mockRejectedValue(
        Object.assign(new Error('example missing pip'), { code: 'ENOENT' }),
      )
    }
    expect(await installPythonPackage('example-package', { quiet: true })).toBe(
      false,
    )
    expect(io.retries).toHaveBeenCalledOnce()
  },
)

test('a version probe lost during recheck falls through to an ordinary installation', async () => {
  io.spawn
    .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    .mockResolvedValueOnce({ code: 0, stdout: '0.9.0', stderr: '' })
    .mockRejectedValueOnce(
      Object.assign(new Error('example probe failed'), {
        code: 1,
        stdout: '',
        stderr: '',
      }),
    )
  expect(await ensurePythonPackage('example-package', { quiet: true })).toEqual(
    { available: true, installed: true },
  )
  expect(io.retries).toHaveBeenCalledOnce()
})

test('a lost version recheck with auto-install disabled remains unavailable', async () => {
  io.spawn
    .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    .mockResolvedValueOnce({ code: 0, stdout: '0.9.0', stderr: '' })
    .mockRejectedValueOnce(new Error('example probe failed'))
  expect(
    await ensurePythonPackage('example-package', {
      quiet: true,
      autoInstall: false,
    }),
  ).toEqual({ available: false, installed: false })
  expect(io.retries).not.toHaveBeenCalled()
})

test('an empty mismatched version can be repaired quietly', async () => {
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  expect(
    await retryPythonVersionMismatch({
      checkName: 'example_package',
      packageName: 'example-package',
      expectedVersion: '1.2.3',
      quiet: true,
      autoInstall: true,
    }),
  ).toEqual({ available: true, installed: true })
  expect(io.retries).toHaveBeenCalledOnce()
})

test('quiet batch continues after a missing version pin', async () => {
  io.spawn.mockRejectedValue(
    Object.assign(new Error('example import unavailable'), { code: 1 }),
  )
  io.spec.mockImplementationOnce(() => {
    throw new Error('example pin missing')
  })
  expect(
    await ensureAllPythonPackages(['example-first', 'example-second'], {
      quiet: true,
    }),
  ).toEqual({
    allAvailable: false,
    installed: ['example-second'],
    missing: ['example-first'],
  })
})
