import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import {
  checkCompiler,
  checkDiskSpace,
  checkNetworkConnectivity,
  checkPythonVersion,
} from 'local-build-infra/lib/build-operations'
import {
  ensureGccVersion,
  getGccInstructions,
} from 'local-build-infra/lib/compiler-installer'
import {
  ensureAllToolsInstalled,
  ensurePackageManagerAvailable,
  getInstallInstructions,
  getPackageManagerInstructions,
} from 'local-build-infra/lib/tool-installer'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  checkBuildEnvironment,
  checkRequiredTools,
} from '../../scripts/binary-released/shared/preflight-checks.mts'
vi.mock(import('local-build-infra/lib/build-operations'), async original => ({
  ...(await original()),
  checkCompiler: vi.fn(),
  checkDiskSpace: vi.fn(),
  checkNetworkConnectivity: vi.fn(),
  checkPythonVersion: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/compiler-installer'), () => ({
  ensureGccVersion: vi.fn(),
  getGccInstructions: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/tool-installer'), () => ({
  ensureAllToolsInstalled: vi.fn(),
  ensurePackageManagerAvailable: vi.fn(),
  getInstallInstructions: vi.fn(),
  getPackageManagerInstructions: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/version-metadata'), () => ({
  getMinPythonVersion: () => '3.11',
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(checkDiskSpace).mockResolvedValue({
    availableGB: 20,
    sufficient: true,
  })
  vi.mocked(checkPythonVersion).mockResolvedValue({
    available: true,
    sufficient: true,
    version: '3.11',
  })
  vi.mocked(checkCompiler).mockResolvedValue({
    available: true,
    compiler: 'clang++',
  })
  vi.mocked(checkNetworkConnectivity).mockResolvedValue({ connected: true })
  vi.mocked(ensureGccVersion).mockResolvedValue({
    available: true,
    installed: false,
    version: '12.2.0',
  })
  vi.mocked(getGccInstructions).mockReturnValue(['fixture GCC instructions'])
  vi.mocked(ensurePackageManagerAvailable).mockResolvedValue({
    available: true,
    installed: false,
    manager: 'brew',
  })
  vi.mocked(ensureAllToolsInstalled).mockResolvedValue({
    allAvailable: true,
    installed: [],
    missing: [],
  })
  vi.mocked(getInstallInstructions).mockReturnValue([
    'fixture tool instructions',
  ])
  vi.mocked(getPackageManagerInstructions).mockReturnValue([
    'fixture package manager instructions',
  ])
  vi.mocked(whichSync).mockReturnValue('/example/tool')
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: 'Xcode 16.2',
    stderr: '',
    pid: 0,
  })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor)
})
test.each(['disk', 'old-python', 'missing-python', 'compiler', 'network'])(
  'refuses an unsuitable build environment: %s',
  async defect => {
    if (defect === 'disk') {
      vi.mocked(checkDiskSpace).mockResolvedValue({
        availableGB: 1,
        sufficient: false,
      })
    }
    if (defect === 'old-python') {
      vi.mocked(checkPythonVersion).mockResolvedValue({
        available: true,
        sufficient: false,
        version: '3.5',
      })
    }
    if (defect === 'missing-python') {
      vi.mocked(checkPythonVersion).mockResolvedValue({
        available: false,
        sufficient: false,
        version: undefined,
      })
    }
    if (defect === 'compiler') {
      vi.mocked(checkCompiler).mockResolvedValue({
        available: false,
        compiler: undefined,
      })
    }
    if (defect === 'network') {
      vi.mocked(checkNetworkConnectivity).mockResolvedValue({
        connected: false,
      })
    }
    await expect(checkBuildEnvironment('/example/build')).rejects.toThrow()
    expect(checkNetworkConnectivity).toHaveBeenCalledTimes(1)
  },
)
test('continues with an unavailable disk measurement when all required tools work', async () => {
  vi.mocked(checkDiskSpace).mockResolvedValue({
    availableGB: undefined,
    sufficient: false,
  })
  await expect(checkBuildEnvironment('/example/build')).resolves.toBeUndefined()
})
test.each([true, false])(
  'requires sufficient GCC on Linux, available=%s',
  async available => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    vi.mocked(checkCompiler).mockResolvedValue({
      available: true,
      compiler: 'g++',
    })
    vi.mocked(ensureGccVersion).mockResolvedValue({
      available,
      installed: false,
      version: available ? '12.2.0' : '11.0.0',
    })
    if (available) {
      await expect(
        checkBuildEnvironment('/example/build'),
      ).resolves.toBeUndefined()
    } else {
      await expect(checkBuildEnvironment('/example/build')).rejects.toThrow()
    }
    expect(ensureGccVersion).toHaveBeenCalledExactlyOnceWith({
      autoInstall: true,
      quiet: false,
    })
    expect(spawn).not.toHaveBeenCalled()
  },
)
test.each(['old', 'unrecognized', 'unavailable'])(
  'handles Xcode %s result',
  async state => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    if (state === 'unavailable') {
      vi.mocked(spawn).mockRejectedValue(new Error('fixture unavailable Xcode'))
    } else {
      vi.mocked(spawn).mockResolvedValue({
        code: 0,
        stdout: state === 'old' ? 'Xcode 15.2' : 'fixture unknown output',
        stderr: '',
        pid: 0,
      })
    }
    if (state === 'old') {
      await expect(checkBuildEnvironment('/example/build')).rejects.toThrow()
    } else {
      await expect(
        checkBuildEnvironment('/example/build'),
      ).resolves.toBeUndefined()
    }
  },
)
test.each(['present', 'installed', 'unavailable'])(
  'propagates package manager state %s into tool setup',
  async state => {
    vi.mocked(ensurePackageManagerAvailable).mockResolvedValue({
      available: state !== 'unavailable',
      installed: state === 'installed',
      manager: state === 'unavailable' ? undefined : 'brew',
    })
    vi.mocked(ensureAllToolsInstalled).mockResolvedValue({
      allAvailable: true,
      installed: ['git'],
      missing: [],
    })
    await checkRequiredTools({ arch: 'arm64', autoYes: true })
    expect(ensurePackageManagerAvailable).toHaveBeenCalledExactlyOnceWith({
      autoInstall: true,
      autoYes: true,
    })
    expect(ensureAllToolsInstalled).toHaveBeenCalledExactlyOnceWith(
      ['git', 'curl', 'patch', 'make'],
      { autoInstall: state !== 'unavailable', autoYes: true },
    )
    expect(whichSync).toHaveBeenCalledWith('strip', { nothrow: true })
    if (process.platform === 'darwin') {
      expect(whichSync).toHaveBeenCalledWith('codesign', { nothrow: true })
    }
  },
)
test.each(['automatic', 'manual'])(
  'reports missing %s tools without claiming readiness',
  async category => {
    if (category === 'automatic') {
      vi.mocked(ensureAllToolsInstalled).mockResolvedValue({
        allAvailable: false,
        installed: [],
        missing: ['git'],
      })
    } else {
      vi.mocked(whichSync).mockReturnValue(undefined)
    }
    await expect(
      checkRequiredTools({ arch: 'x64', autoYes: false }),
    ).rejects.toThrow()
    expect(getInstallInstructions).toHaveBeenCalledWith(
      category === 'automatic' ? 'git' : 'strip',
    )
  },
)
