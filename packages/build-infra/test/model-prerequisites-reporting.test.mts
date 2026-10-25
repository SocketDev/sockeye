import { beforeEach, expect, test, vi } from 'vitest'
import {
  checkModelBuildPrerequisites,
  ensureModelPython,
  extractPythonPackages,
} from '../lib/model-prerequisites.mts'
const io = vi.hoisted(() => ({
  disk: vi.fn(),
  free: vi.fn(),
  python: vi.fn(),
  tool: vi.fn(),
  packages: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  step: vi.fn(),
  error: vi.fn(),
}))
vi.mock(import('../lib/build-operations.mts'), () => ({
  freeDiskSpace: io.free,
  checkDiskSpace: io.disk,
  checkPythonVersion: io.python,
}))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  loadAllTools: () => ({
    onnxruntime: { packageManager: 'pip' },
    'example-package': { type: 'python' },
    pip: { packageManager: 'pip' },
  }),
}))
vi.mock(import('../lib/version-metadata.mts'), () => ({
  getMinPythonVersion: () => '3.12',
}))
vi.mock(import('../lib/python-installer-ops.mts'), () => ({
  ensureAllPythonPackages: io.packages,
}))
vi.mock(import('../lib/tool-installer.mts'), () => ({
  ensureToolInstalled: io.tool,
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: io.error }))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    step: io.step,
    substep: vi.fn(),
    warn: io.warn,
    success: io.success,
    error: io.error,
  }),
}))
beforeEach(() => {
  vi.clearAllMocks()
  io.disk.mockResolvedValue(true)
  io.free.mockResolvedValue(undefined)
  io.python.mockResolvedValue(true)
  io.tool.mockResolvedValue({ available: true, installed: true })
  io.packages.mockResolvedValue({
    allAvailable: true,
    installed: [],
    missing: [],
  })
})
test.each([false, true])(
  'reports package installation=%s and passes consumer context',
  async installed => {
    io.packages.mockResolvedValue({
      allAvailable: true,
      installed: installed ? ['onnxruntime'] : [],
      missing: [],
    })
    const result = await checkModelBuildPrerequisites({
      packageRoot: '/example/model',
      packageJsonPath: '/example/model/package.json',
      buildDir: '/example/build',
      requiredDiskGB: 3,
    })
    expect(io.disk).toHaveBeenCalledWith('/example/build', 3)
    expect(io.packages).toHaveBeenCalledWith(result.pythonPackages, {
      autoInstall: true,
      consumerPackageJsonPath: '/example/model/package.json',
      quiet: false,
    })
    expect(io.success).toHaveBeenCalledWith(
      installed
        ? 'Installed Python packages: onnxruntime'
        : 'All Python packages available',
    )
    expect(io.free.mock.invocationCallOrder[0]).toBeLessThan(
      io.tool.mock.invocationCallOrder[0],
    )
  },
)
test.each([false, true])(
  'unavailable disk measurement warns only when quiet=%s is false',
  async quiet => {
    io.disk.mockResolvedValue(false)
    await checkModelBuildPrerequisites({ buildDir: '/example/build', quiet })
    expect(io.disk).toHaveBeenCalledWith('/example/build', 1)
    expect(io.warn).toHaveBeenCalledTimes(quiet ? 0 : 1)
  },
)
test('quiet Python installation suppresses progress but still verifies version', async () => {
  await ensureModelPython(true)
  expect(io.python).toHaveBeenCalledWith('3.12')
  expect(io.success).not.toHaveBeenCalled()
})
test('extracts both Python pin shapes, excludes pip bootstrap and unrelated tools', () => {
  expect(
    extractPythonPackages({
      pip: { packageManager: 'pip' },
      'example-versioned': { versions: { pip: '1.0.0' } },
      'example-type': { type: 'python' },
      'example-system': { versions: { apt: '2.0.0' } },
      'example-empty': {},
      onnxruntime: { packageManager: 'pip' },
    }),
  ).toEqual([
    'example-versioned',
    'example-type',
    { name: 'onnxruntime', importName: 'onnxruntime' },
  ])
})
test('missing object-shaped Python dependency prints its actual package name', async () => {
  io.packages.mockResolvedValue({
    allAvailable: false,
    installed: [],
    missing: ['onnxruntime'],
  })
  await expect(checkModelBuildPrerequisites({})).rejects.toThrow()
  expect(io.error).toHaveBeenCalledWith(
    '  pip3 install --user onnxruntime example-package',
  )
})
