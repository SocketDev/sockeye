import { beforeEach, expect, test, vi } from 'vitest'
import { checkModelBuildPrerequisites } from '../lib/model-prerequisites.mts'
import { checkPythonVersion } from '../lib/build-operations.mts'
import { ensureAllPythonPackages } from '../lib/python-installer-ops.mts'
import { ensureToolInstalled } from '../lib/tool-installer.mts'

vi.mock(import('../lib/build-operations.mts'), () => ({
  freeDiskSpace: vi.fn(),
  checkDiskSpace: vi.fn().mockResolvedValue(true),
  checkPythonVersion: vi.fn(),
}))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  loadAllTools: () => ({ example: { packageManager: 'pip' } }),
}))
vi.mock(import('../lib/version-metadata.mts'), () => ({
  getMinPythonVersion: () => '3.12',
}))
vi.mock(import('../lib/python-installer-ops.mts'), () => ({
  ensureAllPythonPackages: vi.fn(),
}))
vi.mock(import('../lib/tool-installer.mts'), () => ({
  ensureToolInstalled: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ensureToolInstalled).mockResolvedValue({
    available: true,
    installed: false,
  })
  vi.mocked(checkPythonVersion).mockResolvedValue(true)
  vi.mocked(ensureAllPythonPackages).mockResolvedValue({
    allAvailable: true,
    installed: [],
    missing: [],
  })
})

test('installs declared Python packages after checking the interpreter', async () => {
  const result = await checkModelBuildPrerequisites({ quiet: true })
  expect(result.pythonPackages).toEqual(['example'])
  expect(ensureAllPythonPackages).toHaveBeenCalledWith(result.pythonPackages, {
    autoInstall: true,
    consumerPackageJsonPath: undefined,
    quiet: false,
  })
})

test('rejects an unavailable Python interpreter before installing packages', async () => {
  vi.mocked(ensureToolInstalled).mockResolvedValue({
    available: false,
    installed: false,
  })
  await expect(checkModelBuildPrerequisites({ quiet: true })).rejects.toThrow()
  expect(ensureAllPythonPackages).not.toHaveBeenCalled()
})

test('rejects an old Python interpreter before installing packages', async () => {
  vi.mocked(checkPythonVersion).mockResolvedValue(false)
  await expect(checkModelBuildPrerequisites({ quiet: true })).rejects.toThrow()
  expect(ensureAllPythonPackages).not.toHaveBeenCalled()
})

test('rejects an incomplete Python package installation', async () => {
  vi.mocked(ensureAllPythonPackages).mockResolvedValue({
    allAvailable: false,
    installed: [],
    missing: ['example'],
  })
  await expect(checkModelBuildPrerequisites({ quiet: true })).rejects.toThrow()
})
