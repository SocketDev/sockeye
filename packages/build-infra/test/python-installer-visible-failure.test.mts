import { expect, test, vi } from 'vitest'
import { installPythonPackage } from '../lib/python-installer-ops.mts'

const io = vi.hoisted(() => ({ retries: vi.fn(), error: vi.fn() }))
vi.mock(import('../lib/python-installer.mts'), () => ({
  getPipCommand: () => 'example-pip',
  getPythonCommand: async () => 'example-python',
  initializeVenv: vi.fn(),
  venvInitialized: true,
}))
vi.mock(import('../lib/python-package-pin.mts'), () => ({
  getExpectedPythonVersion: () => '1.2.3',
  getPythonInstallSpec: () => 'example-package==1.2.3',
}))
vi.mock(import('../lib/python-pip-retry.mts'), () => ({
  getPythonInstallArgs: () => ['install', 'example-package==1.2.3'],
  runPythonPipRetries: io.retries,
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: io.error }))

test('a failed verbose pip retry reports failure and retains inherited progress output', async () => {
  io.retries.mockResolvedValue(2)
  expect(await installPythonPackage('example-package', { quiet: false })).toBe(
    false,
  )
  expect(io.retries).toHaveBeenCalledOnce()
  expect(io.retries.mock.calls[0]?.[0]).toMatchObject({
    pip: 'example-pip',
    quiet: false,
    spawnOptions: { stdio: 'inherit' },
  })
  expect(io.error).toHaveBeenCalledOnce()
})
