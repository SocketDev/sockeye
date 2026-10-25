import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createSetupToolchain,
  runSetupToolchain,
} from '../lib/setup-build-toolchain.mts'

const io = vi.hoisted(() => ({
  platform: vi.fn(),
  ci: vi.fn(),
  install: vi.fn(),
  update: vi.fn(),
  submodule: vi.fn(),
}))
vi.mock(import('../lib/build-env.mts'), () => ({ getPlatform: io.platform }))
vi.mock(import('@socketsecurity/lib-stable/env/ci'), () => ({ isCI: io.ci }))
vi.mock(import('../lib/install-tools.mts'), () => ({
  installTools: io.install,
  updatePackageCache: io.update,
}))
vi.mock(import('../lib/submodule-init.mts'), () => ({
  ensureSubmodule: io.submodule,
}))
let previousExit: typeof process.exitCode
beforeEach(() => {
  previousExit = process.exitCode
  vi.resetAllMocks()
  io.platform.mockReturnValue('darwin')
  io.ci.mockReturnValue(false)
  io.install.mockResolvedValue({ installed: ['example-compiler'], failed: [] })
  io.update.mockResolvedValue(undefined)
  io.submodule.mockResolvedValue(undefined)
})
afterEach(() => {
  process.exitCode = previousExit
})

test.each([
  ['darwin', ['clang', 'make']],
  ['linux', ['gcc', 'make']],
  ['win32', ['mingw-w64', 'make']],
])(
  'installs the default %s toolchain with platform-specific options',
  async (platform, tools) => {
    io.platform.mockReturnValue(platform)
    expect(await createSetupToolchain({})('/example/package')).toBe(true)
    expect(io.install).toHaveBeenCalledWith(
      tools,
      platform === 'darwin'
        ? { packageRoot: '/example/package', skipVersionPin: true }
        : { packageRoot: '/example/package' },
    )
    expect(io.update).toHaveBeenCalledTimes(platform === 'linux' ? 1 : 0)
  },
)

test.each(['darwin', 'linux', 'win32'])(
  'reports custom %s installation success and failure',
  async platform => {
    io.platform.mockReturnValue(platform)
    const config = {
      [platform]: ['example-tool'],
      [`${platform}Note`]: 'Example setup note',
    }
    expect(await createSetupToolchain(config)('/example/package')).toBe(true)
    expect(io.install.mock.calls[0]?.[0]).toEqual(['example-tool'])
    io.install.mockResolvedValue({ installed: [], failed: ['example-tool'] })
    expect(await createSetupToolchain(config)('/example/package')).toBe(false)
  },
)

test('handles clang-only failure without invoking a package manager', async () => {
  io.install.mockResolvedValue({ installed: [], failed: ['clang'] })
  expect(
    await createSetupToolchain({ darwin: ['clang', 'clang++'] })(
      '/example/package',
    ),
  ).toBe(false)
  expect(io.install).toHaveBeenCalledTimes(1)
})

test('refuses unsupported platforms', async () => {
  io.platform.mockReturnValue('example-platform')
  expect(await createSetupToolchain({})('/example/package')).toBe(false)
  expect(io.install).not.toHaveBeenCalled()
})

test('CI skips installation and submodule mutation', async () => {
  io.ci.mockReturnValue(true)
  await runSetupToolchain({
    packageName: 'example-builder',
    packageRoot: '/example/packages/builder',
    tools: {},
    submodules: [{ path: 'example-source' }],
  })
  expect(io.install).not.toHaveBeenCalled()
  expect(io.submodule).not.toHaveBeenCalled()
  expect(process.exitCode).toBe(previousExit)
})

test('initializes submodules sequentially before installing tools', async () => {
  await runSetupToolchain({
    packageName: 'example-builder',
    packageRoot: '/example/packages/builder',
    tools: {},
    submodules: [{ path: 'first-source' }, { path: 'second-source' }],
  })
  expect(io.submodule.mock.calls).toEqual([
    [{ monorepoRoot: '/example', path: 'first-source' }],
    [{ monorepoRoot: '/example', path: 'second-source' }],
  ])
  expect(io.submodule.mock.invocationCallOrder[1]).toBeLessThan(
    io.install.mock.invocationCallOrder[0]!,
  )
  expect(process.exitCode).toBe(previousExit)
})

test('marks unsuccessful setup and exceptions as failures', async () => {
  io.install.mockResolvedValue({ installed: [], failed: ['example-tool'] })
  await runSetupToolchain({
    packageName: 'example-builder',
    packageRoot: '/example/package',
    tools: {},
  })
  expect(process.exitCode).toBe(1)
  process.exitCode = 0
  io.install.mockRejectedValue(new Error('fixture install failure'))
  await runSetupToolchain({
    packageName: 'example-builder',
    packageRoot: '/example/package',
    tools: {},
  })
  expect(process.exitCode).toBe(1)
})
