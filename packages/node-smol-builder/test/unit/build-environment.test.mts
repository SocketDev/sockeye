import { beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import {
  checkCompiler,
  checkDiskSpace,
  checkNetworkConnectivity,
  checkPythonVersion,
} from 'local-build-infra/lib/build-operations'
import { printError } from 'local-build-infra/lib/build-output'
import { getMinPythonVersion } from 'local-build-infra/lib/version-metadata'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { checkBuildEnvironment } from '../../scripts/binary-released/shared/preflight-checks.mts'
vi.mock(import('local-build-infra/lib/build-operations'), async original => ({
  ...(await original()),
  checkCompiler: vi.fn(),
  checkDiskSpace: vi.fn(),
  checkNetworkConnectivity: vi.fn(),
  checkPythonVersion: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/build-output'), () => ({
  printError: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/version-metadata'), () => ({
  getMinPythonVersion: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getMinPythonVersion).mockReturnValue('3.11')
  vi.mocked(checkDiskSpace).mockResolvedValue({
    availableGB: 20,
    sufficient: true,
  })
  vi.mocked(checkPythonVersion).mockResolvedValue({
    available: true,
    sufficient: true,
    version: '3.11.0',
  })
  vi.mocked(checkCompiler).mockResolvedValue({
    available: true,
    compiler: 'clang++',
  })
  vi.mocked(checkNetworkConnectivity).mockResolvedValue({ connected: true })
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: 'Xcode 16.2\nBuild version 16C5032a',
    stderr: '',
    pid: 0,
  })
})
test('reports Python requirement in failure guidance without a scope error', async () => {
  vi.mocked(checkPythonVersion).mockResolvedValue({
    available: false,
    sufficient: false,
    version: undefined,
  })
  await expect(checkBuildEnvironment('/example/build')).rejects.toThrow()
  expect(checkPythonVersion).toHaveBeenCalledExactlyOnceWith('3.11')
  expect(printError).toHaveBeenCalledTimes(1)
  expect(vi.mocked(printError).mock.calls[0]).toContainEqual(
    expect.arrayContaining([
      'Python: Install Python 3.11+ (python.org or brew install python)',
    ]),
  )
})
test.runIf(process.platform === 'darwin')(
  'checks Xcode through the actual build process helper',
  async () => {
    await expect(
      checkBuildEnvironment('/example/build'),
    ).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledExactlyOnceWith('xcodebuild', ['-version'], {
      encoding: 'utf8',
      shell: false,
    })
    expect(printError).not.toHaveBeenCalled()
  },
)
