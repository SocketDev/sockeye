import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  buildBinSuitePackage,
  defaultSmokeTest,
  isCrossCompiling,
  selectMakefile,
} from '../lib/builder.mts'

const state = vi.hoisted(() => ({
  exists: vi.fn(),
  stat: vi.fn(),
  spawn: vi.fn(),
  command: vi.fn(),
  checkpoint: vi.fn(),
  windows: false,
}))

vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    existsSync: state.exists,
    promises: { ...actual.promises, stat: state.stat },
  }
})
vi.mock(import('local-build-infra/lib/build-operations'), () => ({
  getFileSize: async () => 4096,
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), () => ({
  createCheckpoint: state.checkpoint,
  shouldRun: async () => true,
}))
vi.mock(import('local-build-infra/lib/constants'), () => ({
  BUILD_STAGES: { FINAL: 'Final' },
  CHECKPOINTS: { FINALIZED: 'finalized' },
  CHECKPOINT_CHAINS: { simple: () => ['finalized'] },
  getBuildMode: () => 'prod',
  getPlatformBuildDir: () => '/example/build',
}))
vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  getCurrentPlatformArch: async () => 'linux-x64-musl',
  parsePlatformArch: () => ({ arch: 'x64', platform: 'linux', libc: 'musl' }),
}))
vi.mock(import('local-build-infra/lib/script-runner'), () => ({
  runCommand: state.command,
}))
vi.mock(import('@socketsecurity/lib-stable/constants/platform'), () => ({
  isWin32: () => state.windows,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: state.spawn,
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('TARGET_ARCH', '')
  state.windows = false
  state.exists.mockReturnValue(true)
  state.stat.mockResolvedValue({ size: 4096 })
  state.spawn.mockResolvedValue({ code: 0, stdout: 'example-tool 1.0.0' })
  state.checkpoint.mockImplementation(async (directory, name, verify) => {
    expect(directory).toBe('/example/build')
    expect(name).toBe('finalized')
    await verify()
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test('builds, verifies, and records the explicit platform artifact metadata', async () => {
  const beforeBuild = vi.fn()
  const smokeTest = vi.fn()
  await buildBinSuitePackage({
    packageName: 'example-tool',
    packageDir: '/example/package',
    beforeBuild,
    smokeTest,
  })
  expect(beforeBuild).toHaveBeenCalledWith({
    buildDir: '/example/build',
    buildMode: 'prod',
    packageDir: '/example/package',
  })
  expect(state.command).toHaveBeenCalledWith(
    'node',
    ['/example/package/scripts/check-tools.mts'],
    '/example/package',
  )
  expect(state.spawn).toHaveBeenCalledTimes(2)
  expect(state.spawn).toHaveBeenLastCalledWith(
    'make',
    ['-f', selectMakefile(), 'all'],
    expect.objectContaining({
      cwd: '/example/package',
      env: expect.objectContaining({
        PLATFORM_ARCH: 'linux-x64-musl',
        BUILD_MODE: 'prod',
      }),
    }),
  )
  expect(smokeTest).toHaveBeenCalledWith(
    '/example/build/out/Final/example-tool',
  )
  expect(state.checkpoint).toHaveBeenCalledWith(
    '/example/build',
    'finalized',
    expect.any(Function),
    {
      arch: 'x64',
      platform: 'linux',
      libc: 'musl',
      platformArch: 'linux-x64-musl',
      artifactPath: '/example/build/out/Final',
      binaryPath: 'out/Final/example-tool',
      binarySize: 4096,
      checkpointChain: ['finalized'],
    },
  )
})

test('skips cleaning when requested and uses the default smoke check', async () => {
  await buildBinSuitePackage({
    packageName: 'example-tool',
    packageDir: '/example/package',
    skipClean: true,
  })
  expect(state.spawn).toHaveBeenCalledTimes(2)
  expect(state.spawn).toHaveBeenLastCalledWith(
    '/example/build/out/Final/example-tool',
    ['--version'],
  )
})

test('does not checkpoint a missing artifact', async () => {
  state.exists.mockReturnValue(false)
  await buildBinSuitePackage({
    packageName: 'example-tool',
    packageDir: '/example/package',
  })
  expect(state.checkpoint).not.toHaveBeenCalled()
})

test('does not execute a cross-compiled artifact', async () => {
  vi.stubEnv('TARGET_ARCH', process.arch === 'arm64' ? 'x64' : 'arm64')
  const smokeTest = vi.fn()
  await buildBinSuitePackage({
    packageName: 'example-tool',
    packageDir: '/example/package',
    smokeTest,
  })
  expect(state.checkpoint).toHaveBeenCalledOnce()
  expect(smokeTest).not.toHaveBeenCalled()
  expect(state.spawn).toHaveBeenCalledTimes(2)
})

test('uses executable suffix and shell on Windows', async () => {
  state.windows = true
  const smokeTest = vi.fn()
  await buildBinSuitePackage({
    packageName: 'example-tool',
    packageDir: '/example/package',
    smokeTest,
  })
  expect(smokeTest).toHaveBeenCalledWith(
    '/example/build/out/Final/example-tool.exe',
  )
  expect(state.spawn.mock.calls[0]?.[2].shell).toBe(true)
})

test('does not checkpoint after a compiler failure', async () => {
  state.spawn.mockRejectedValue(new Error('Fixture compiler failed'))
  await expect(
    buildBinSuitePackage({
      packageName: 'example-tool',
      packageDir: '/example/package',
    }),
  ).rejects.toThrow()
  expect(state.checkpoint).not.toHaveBeenCalled()
})

test('rejects undersized binaries before executing them', async () => {
  state.stat.mockResolvedValue({ size: 999 })
  await expect(
    defaultSmokeTest('/example/tool', 'example-tool'),
  ).rejects.toThrow()
  expect(state.spawn).not.toHaveBeenCalled()
})

test('accepts the minimum binary size', async () => {
  state.stat.mockResolvedValue({ size: 1000 })
  await expect(
    defaultSmokeTest('/example/tool', 'example-tool'),
  ).resolves.toBeUndefined()
})

test('propagates failure to execute the version command', async () => {
  const failure = new Error('Fixture version command failed')
  state.spawn.mockRejectedValue(failure)
  await expect(defaultSmokeTest('/example/tool', 'example-tool')).rejects.toBe(
    failure,
  )
})

test.each([
  { code: 0, stdout: '' },
  { code: 0, stdout: 'different-tool' },
])('rejects an invalid version result %j', async result => {
  state.spawn.mockResolvedValue(result)
  await expect(
    defaultSmokeTest('/example/tool', 'example-tool'),
  ).rejects.toThrow()
})

test.each(['', 'arm64', 'aarch64', 'x64'])(
  'detects cross compilation for %s',
  target => {
    vi.stubEnv('TARGET_ARCH', target)
    expect(isCrossCompiling()).toBe(
      Boolean(target) &&
        (target === 'aarch64' ? 'arm64' : target) !== process.arch,
    )
  },
)

test.each(['linux', 'darwin', 'win32'])(
  'selects the makefile for %s',
  platform => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    state.windows = platform === 'win32'
    expect(selectMakefile()).toBe(
      platform === 'linux'
        ? 'Makefile.linux'
        : platform === 'win32'
          ? 'Makefile.win'
          : 'Makefile.macos',
    )
  },
)
