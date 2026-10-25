import { beforeEach, expect, test, vi } from 'vitest'
import {
  checkPythonPackage,
  checkPythonPackageVersion,
  ensureAllPythonPackages,
  ensurePythonPackage,
  getPythonPackageInstructions,
  installPythonPackage,
  retryPythonVersionMismatch,
} from '../lib/python-installer-ops.mts'
const io = vi.hoisted(() => ({
  python: 'example-python' as string | undefined,
  pip: 'example-pip' as string | undefined,
  initialized: true,
  initialize: vi.fn(),
  spawn: vi.fn(),
  pins: vi.fn(),
  summary: vi.fn(),
  error: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/python-installer.mts'), () => ({
  getPythonCommand: async () => io.python,
  getPipCommand: () => io.pip,
  initializeVenv: io.initialize,
  get venvInitialized() {
    return io.initialized
  },
  venvAvailable: false,
  isPEP668Managed: () => false,
  setCachedPEP668: vi.fn(),
}))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getPinnedPackage: (name: string) => `${name}==1.2.3`,
  loadPythonVersions: io.pins,
  PYTHON_VERSIONS: { 'example-package': '1.2.3' },
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: io.error }))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    info: io.summary,
    success: io.summary,
    substep: io.summary,
    warn: io.summary,
    error: io.error,
  }),
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.python = 'example-python'
  io.pip = 'example-pip'
  io.initialized = true
  io.spawn.mockResolvedValue({ code: 0, stdout: '1.2.3', stderr: '', pid: 0 })
})

test('missing interpreters and rejected imports fail package checks without installation', async () => {
  io.python = undefined
  expect(await checkPythonPackage('example_package')).toBe(false)
  expect(await checkPythonPackageVersion('example_package', '1.2.3')).toBe(
    false,
  )
  expect(io.spawn).not.toHaveBeenCalled()
  io.python = 'example-python'
  io.spawn.mockRejectedValue(new Error('example import failure'))
  expect(await checkPythonPackage('example_package')).toBe(false)
  expect(await checkPythonPackageVersion('example_package', '1.2.3')).toBe(
    false,
  )
})

test('initializes the venv before rejecting a missing pip', async () => {
  io.initialized = false
  io.pip = undefined
  expect(await installPythonPackage('example-package')).toBe(false)
  expect(io.initialize).toHaveBeenCalledWith({ quiet: false })
  expect(io.error).toHaveBeenCalledOnce()
  expect(io.spawn).not.toHaveBeenCalled()
})

test('verbose installation preserves the ABI environment and reports subprocess rejection', async () => {
  expect(await installPythonPackage('example-package', { user: false })).toBe(
    true,
  )
  expect(io.spawn.mock.calls[0]?.[2]).toMatchObject({
    env: { PYO3_USE_ABI3_FORWARD_COMPATIBILITY: '1' },
    stdio: 'inherit',
  })
  expect(io.spawn.mock.calls[0]?.[1]).not.toContain('--user')
  io.spawn.mockRejectedValue(new Error('example spawn failure'))
  expect(await installPythonPackage('example-package')).toBe(false)
  expect(io.error).toHaveBeenCalled()
})

test('accepts an installed unpinned import alias and installs a missing package', async () => {
  expect(
    await ensurePythonPackage('unpinned-package', {
      importName: 'example_import',
    }),
  ).toEqual({ available: true, installed: false })
  expect(io.spawn.mock.calls[0]?.[1]).toEqual(['-c', 'import example_import'])
  io.spawn.mockRejectedValueOnce(new Error('example missing import'))
  expect(await ensurePythonPackage('example-package')).toEqual({
    available: true,
    installed: true,
  })
  expect(io.spawn.mock.calls.at(-1)?.[1]?.[0]).toBe('install')
})

test('a mismatched installed version triggers a pinned upgrade', async () => {
  io.spawn
    .mockResolvedValueOnce({ code: 0, stdout: '' })
    .mockResolvedValueOnce({ code: 0, stdout: '0.1.0' })
    .mockResolvedValueOnce({ code: 0, stdout: '0.1.0' })
  expect(await ensurePythonPackage('example-package')).toEqual({
    available: true,
    installed: true,
  })
  expect(io.spawn.mock.calls.at(-1)?.[1]).toContain('--upgrade')
})

test('failed mismatch probes allow the caller to attempt reinstall', async () => {
  io.spawn.mockRejectedValueOnce(new Error('example version probe failed'))
  expect(
    await retryPythonVersionMismatch({
      checkName: 'example_import',
      packageName: 'example-package',
      expectedVersion: '1.2.3',
      quiet: false,
      autoInstall: true,
    }),
  ).toBeUndefined()
})

test('collects installation errors and missing packages without dropping later results', async () => {
  io.pins.mockReturnValue({ PYTHON_PACKAGE_EXTRAS: {}, PYTHON_VERSIONS: {} })
  io.spawn.mockRejectedValue(new Error('example missing package'))
  expect(
    await ensureAllPythonPackages(
      [
        { name: 'example-package', importName: 'example_import' },
        'second-package',
      ],
      { consumerPackageJsonPath: '/example/package.json' },
    ),
  ).toEqual({
    allAvailable: false,
    installed: [],
    missing: ['example-package', 'second-package'],
  })
  expect(io.error).toHaveBeenCalledTimes(2)
})

test('reports both newly installed and already available complete inventories', async () => {
  io.spawn.mockRejectedValueOnce(new Error('example missing import'))
  expect(
    await ensureAllPythonPackages(['example-package', 'unpinned-package']),
  ).toEqual({ allAvailable: true, installed: ['example-package'], missing: [] })
  expect(
    await ensureAllPythonPackages(['example-package', 'unpinned-package']),
  ).toEqual({ allAvailable: true, installed: [], missing: [] })
  expect(io.summary).toHaveBeenCalled()
  expect(getPythonPackageInstructions(['example-package'])).toEqual([
    'Install required Python packages:',
    '  pip3 install --user example-package==1.2.3',
  ])
})
