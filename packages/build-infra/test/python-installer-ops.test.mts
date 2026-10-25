import { loadPythonVersions } from '../lib/pinned-versions.mts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  ensureAllPythonPackages,
  ensurePythonPackage,
  installPythonPackage,
} from '../lib/python-installer-ops.mts'

const pythonState = vi.hoisted(() => ({ managed: false, venv: false }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: vi.fn() }))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getPinnedPackage: () => 'example-package==1.2.3',
  loadPythonVersions: vi.fn(),
  PYTHON_VERSIONS: { 'example-package': '1.2.3' },
}))
vi.mock(import('../lib/python-installer.mts'), () => ({
  getPipCommand: () => 'example-pip',
  getPythonCommand: async () => 'example-python',
  initializeVenv: vi.fn(),
  isPEP668Managed: () => pythonState.managed,
  setCachedPEP668: (managed: boolean) => {
    pythonState.managed = managed
  },
  get venvAvailable() {
    return pythonState.venv
  },
  venvInitialized: true,
}))

beforeEach(() => {
  vi.resetAllMocks()
  pythonState.managed = false
  pythonState.venv = false
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    pid: 0,
    stdout: '',
    stderr: '',
  })
})

describe('Python package installation retries', () => {
  test('installs pinned binary wheels into the user site when no venv exists', async () => {
    expect(await installPythonPackage('example-package', { quiet: true })).toBe(
      true,
    )
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([
      'install',
      '--user',
      '--only-binary=:all:',
      'example-package==1.2.3',
    ])
  })

  test('resolves consumer extras and version from its manifest directory', async () => {
    vi.mocked(loadPythonVersions).mockReturnValue({
      PYTHON_PACKAGE_EXTRAS: { 'example-package': ['feature'] },
      PYTHON_VERSIONS: { 'example-package': '2.3.4' },
    })
    expect(
      await installPythonPackage('example-package', {
        consumerPackageJsonPath: '/example/package/package.json',
        quiet: true,
      }),
    ).toBe(true)
    expect(vi.mocked(loadPythonVersions).mock.calls).toEqual([
      [{ packageRoot: '/example/package' }],
    ])
    expect(vi.mocked(spawn).mock.calls[0]?.[1]?.at(-1)).toBe(
      'example-package[feature]==2.3.4',
    )
  })

  test('rejects a missing consumer pin before spawning pip', async () => {
    vi.mocked(loadPythonVersions).mockReturnValue({
      PYTHON_PACKAGE_EXTRAS: {},
      PYTHON_VERSIONS: {},
    })
    await expect(
      installPythonPackage('example-package', {
        consumerPackageJsonPath: '/example/package/package.json',
        quiet: true,
      }),
    ).rejects.toThrow()
    expect(vi.mocked(spawn).mock.calls).toHaveLength(0)
  })

  test('preserves upgrade and managed-interpreter flags', async () => {
    pythonState.managed = true
    expect(
      await installPythonPackage('example-package', {
        quiet: true,
        upgrade: true,
      }),
    ).toBe(true)
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([
      'install',
      '--user',
      '--upgrade',
      '--break-system-packages',
      '--only-binary=:all:',
      'example-package==1.2.3',
    ])
  })

  test('retains a detected managed-interpreter flag during source fallback', async () => {
    vi.mocked(spawn)
      .mockResolvedValueOnce({
        code: 1,
        pid: 0,
        stdout: '',
        stderr: 'externally-managed-environment',
      })
      .mockResolvedValueOnce({
        code: 1,
        pid: 0,
        stdout: '',
        stderr: 'fixture wheel unavailable',
      })
    expect(await installPythonPackage('example-package', { quiet: true })).toBe(
      true,
    )
    expect(vi.mocked(spawn).mock.calls.map(call => call[1])).toEqual([
      ['install', '--user', '--only-binary=:all:', 'example-package==1.2.3'],
      [
        'install',
        '--user',
        '--only-binary=:all:',
        '--break-system-packages',
        'example-package==1.2.3',
      ],
      [
        'install',
        '--user',
        '--break-system-packages',
        'example-package==1.2.3',
      ],
    ])
  })

  test('uses the venv without user or managed-interpreter flags', async () => {
    pythonState.venv = true
    pythonState.managed = true
    expect(await installPythonPackage('example-package', { quiet: true })).toBe(
      true,
    )
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([
      'install',
      '--only-binary=:all:',
      'example-package==1.2.3',
    ])
  })

  test('stops after the source fallback fails', async () => {
    vi.mocked(spawn).mockResolvedValue({
      code: 1,
      pid: 0,
      stdout: '',
      stderr: '',
    })
    expect(await installPythonPackage('example-package', { quiet: true })).toBe(
      false,
    )
    expect(vi.mocked(spawn).mock.calls).toHaveLength(2)
  })
})

describe('Python package availability', () => {
  test('accepts an installed package only when its pinned version matches', async () => {
    vi.mocked(spawn).mockResolvedValue({
      code: 0,
      pid: 0,
      stdout: '1.2.3',
      stderr: '',
    })
    expect(
      await ensurePythonPackage('example-package', { quiet: true }),
    ).toEqual({ available: true, installed: false })
    expect(vi.mocked(spawn).mock.calls.map(call => call[0])).toEqual([
      'example-python',
      'example-python',
    ])
  })

  test('rejects mismatched versions without installation when disabled', async () => {
    vi.mocked(spawn).mockResolvedValue({
      code: 0,
      pid: 0,
      stdout: '0.1.0',
      stderr: '',
    })
    expect(
      await ensurePythonPackage('example-package', {
        autoInstall: false,
        quiet: true,
      }),
    ).toEqual({ available: false, installed: false })
    expect(vi.mocked(spawn).mock.calls.map(call => call[0])).toEqual([
      'example-python',
      'example-python',
      'example-python',
    ])
  })

  test('collects every unavailable package without installation', async () => {
    vi.mocked(spawn).mockRejectedValue(new Error('example missing import'))
    expect(
      await ensureAllPythonPackages(['example-package', 'other-package'], {
        autoInstall: false,
        quiet: true,
      }),
    ).toEqual({
      allAvailable: false,
      installed: [],
      missing: ['example-package', 'other-package'],
    })
  })
})
