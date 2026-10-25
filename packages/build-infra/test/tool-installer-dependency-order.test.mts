import { beforeEach, expect, test, vi } from 'vitest'
import {
  installMissingTool,
  repairInstalledTool,
} from '../lib/tool-installer-phases.mts'
const io = vi.hoisted(() => ({
  dependency: vi.fn(),
  install: vi.fn(),
  verify: vi.fn(),
  managers: vi.fn(),
  substep: vi.fn(),
  warn: vi.fn(),
}))
vi.mock(import('../lib/build-env.mts'), () => ({ getPlatform: () => 'linux' }))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolConfig: vi.fn(),
}))
vi.mock(import('../lib/tool-installer-config.mts'), () => ({
  detectPackageManagers: io.managers,
}))
vi.mock(import('../lib/tool-installer-impl.mts'), () => ({
  installTool: io.install,
  verifyToolWorks: io.verify,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    warn: io.warn,
    substep: io.substep,
    error: vi.fn(),
  }),
}))
const config = {
  autoInstall: true,
  autoYes: true,
  config: { dependencies: ['example-runtime'], verify: ['--check'] },
  ensureDependency: io.dependency,
  tool: 'example-compiler',
  toolOptions: { packageRoot: '/example/package' },
}
beforeEach(() => {
  vi.clearAllMocks()
  io.dependency.mockResolvedValue({ available: true, installed: true })
  io.install.mockResolvedValue(true)
  io.verify.mockResolvedValue(true)
  io.managers.mockReturnValue(['apt'])
})
test('successful dependencies finish before tool installation and verification', async () => {
  expect(await installMissingTool(config)).toEqual({
    available: true,
    installed: true,
    packageManager: 'apt',
  })
  expect(io.dependency).toHaveBeenCalledWith('example-runtime', {
    autoInstall: true,
    autoYes: true,
    toolOptions: config.toolOptions,
  })
  expect(io.install).toHaveBeenCalledWith('example-compiler', 'apt', {
    autoYes: true,
  })
  expect(io.verify).toHaveBeenCalledWith('example-compiler', ['--check'])
  expect(io.dependency.mock.invocationCallOrder[0]).toBeLessThan(
    io.install.mock.invocationCallOrder[0],
  )
  expect(io.install.mock.invocationCallOrder[0]).toBeLessThan(
    io.verify.mock.invocationCallOrder[0],
  )
})
test('dependency repair cannot report success while the tool remains broken', async () => {
  io.verify.mockResolvedValue(false)
  expect(await repairInstalledTool(config)).toMatchObject({
    available: false,
    installed: false,
  })
  expect(io.verify).toHaveBeenCalledTimes(2)
  expect(io.dependency).toHaveBeenCalledOnce()
  expect(io.install).not.toHaveBeenCalled()
  expect(io.substep).toHaveBeenCalledWith(
    'Try: sudo apt-get install --reinstall example-compiler',
  )
})
test('missing package manager retains the unavailable result and performs no install', async () => {
  io.managers.mockReturnValue([])
  expect(await installMissingTool({ ...config, config: {} })).toEqual({
    available: false,
    installed: false,
    packageManager: undefined,
  })
  expect(io.warn).toHaveBeenCalledWith(
    'No package manager detected for auto-installing example-compiler',
  )
  expect(io.install).not.toHaveBeenCalled()
})
