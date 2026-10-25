import { beforeEach, expect, test, vi } from 'vitest'
import {
  getInstallInstructions,
  getPackageManagerInstructions,
} from '../lib/tool-installer-config.mts'
import {
  repairInstalledTool,
  reportBrokenTool,
} from '../lib/tool-installer-phases.mts'
const io = vi.hoisted(() => ({
  platform: vi.fn(),
  config: vi.fn(),
  verify: vi.fn(),
  substep: vi.fn(),
}))
vi.mock(import('../lib/build-env.mts'), () => ({ getPlatform: io.platform }))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolConfig: io.config,
}))
vi.mock(import('../lib/tool-installer-impl.mts'), () => ({
  verifyToolWorks: io.verify,
  installTool: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    substep: io.substep,
  }),
}))
beforeEach(() => {
  vi.clearAllMocks()
  io.platform.mockReturnValue('linux')
  io.config.mockReturnValue({ description: 'Example compiler' })
  io.verify.mockResolvedValue(false)
})
test.each(['linux', 'win32', 'freebsd'])(
  'installation guidance follows platform %s',
  platform => {
    io.platform.mockReturnValue(platform)
    expect(getInstallInstructions('example-compiler')).toEqual([
      'Install example-compiler (Example compiler):',
      platform === 'linux'
        ? '  sudo apt-get install -y example-compiler'
        : platform === 'win32'
          ? '  choco install example-compiler'
          : '  Install example-compiler using your system package manager',
    ])
  },
)
test('manager guidance distinguishes preinstalled and unsupported platforms', () => {
  expect(getPackageManagerInstructions()).toContain(
    '  (Pre-installed on this system)',
  )
  io.platform.mockReturnValue('freebsd')
  expect(getPackageManagerInstructions()).toEqual([
    'Unsupported platform for package manager auto-installation',
  ])
})
test.each([false, true])(
  'unavailable repair dependency reports configured note=%s',
  hasNote => {
    io.config.mockReturnValue(
      hasNote ? { note: 'Fixture manual install required' } : undefined,
    )
    const ensureDependency = vi.fn().mockResolvedValue({ available: false })
    return expect(
      repairInstalledTool({
        tool: 'example-compiler',
        config: { dependencies: ['example-runtime'] },
        autoInstall: true,
        autoYes: false,
        ensureDependency,
      }),
    ).resolves.toMatchObject({
      available: false,
      installed: false,
      error: `Dependency example-runtime not available: ${hasNote ? 'Fixture manual install required' : 'install required'}`,
    })
  },
)
test.each(['linux', 'win32'])(
  'broken tool preserves notes and platform repair for %s',
  platform => {
    io.platform.mockReturnValue(platform)
    reportBrokenTool({
      tool: 'example-compiler',
      toolConfig: { notes: 'Fixture dependency hint' },
    })
    expect(io.substep).toHaveBeenCalledWith('Fixture dependency hint')
    expect(
      io.substep.mock.calls
        .flat()
        .includes('Try: sudo apt-get install --reinstall example-compiler'),
    ).toBe(platform === 'linux')
  },
)
