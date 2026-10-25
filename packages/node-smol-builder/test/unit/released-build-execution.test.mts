import { beforeEach, expect, test, vi } from 'vitest'
import {
  buildRelease,
  getCheckpointChain,
} from '../../scripts/binary-released/shared/build-released.mts'

const io = vi.hoisted(() => ({
  events: [] as string[],
  windows: false,
  clear: vi.fn(),
  save: vi.fn(),
  exists: vi.fn(),
  cache: vi.fn(),
  checkpoint: vi.fn(),
  collect: vi.fn(),
  tools: vi.fn(),
  environment: vi.fn(),
  mkdir: vi.fn(),
  clone: vi.fn(),
  reset: vi.fn(),
  prepare: vi.fn(),
  restore: vi.fn(),
  additions: vi.fn(),
  patches: vi.fn(),
  verify: vi.fn(),
  flags: vi.fn(),
  shouldRun: vi.fn(),
  configure: vi.fn(),
  compile: vi.fn(),
  finalize: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(import('local-build-infra/lib/build-operations'), () => ({
  clearBuildLog: io.clear,
  saveBuildLog: io.save,
  needsCacheRebuild: io.cache,
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), () => ({
  shouldRun: io.shouldRun,
}))
vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  getCurrentPlatformArch: async () =>
    io.windows ? 'win32-x64' : 'linux-arm64-musl',
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeMkdir: io.mkdir,
}))
vi.mock(import('@socketsecurity/lib-stable/constants/platform'), () => ({
  isWin32: () => io.windows,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    log: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
    substep: vi.fn(),
  }),
}))
vi.mock(import('../../scripts/common/shared/parse-build-args.mts'), () => ({
  calculateCpuCount: () => 7,
}))
vi.mock(
  import('../../scripts/binary-released/shared/copy-additions.mts'),
  () => ({ copyBuildAdditions: io.additions }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-configure.mts'),
  () => ({ getReleaseConfigureFlags: io.flags }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-artifact.mts'),
  () => ({ finalizeReleaseBinary: io.finalize }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-checkpoints.mts'),
  () => ({ inspectReleaseCheckpoints: io.checkpoint }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-compile.mts'),
  () => ({
    configureReleaseBinary: io.configure,
    compileReleaseBinary: io.compile,
  }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-source.mts'),
  () => ({
    resetReleaseSource: io.reset,
    restoreReleaseSource: io.restore,
    verifyReleaseSource: io.verify,
  }),
)
vi.mock(import('../../scripts/binary-released/shared/paths.mts'), () => ({
  PATCHES_SOURCE_PATCHED_DIR: '/example/patches',
}))
vi.mock(
  import('../../scripts/binary-released/shared/preflight-checks.mts'),
  () => ({
    checkRequiredTools: io.tools,
    checkBuildEnvironment: io.environment,
  }),
)
vi.mock(
  import('../../scripts/binary-released/shared/prepare-external-sources.mts'),
  () => ({ prepareExternalSources: io.prepare }),
)
vi.mock(import('../../scripts/source-copied/shared/copy-source.mts'), () => ({
  cloneNodeSource: io.clone,
}))
vi.mock(
  import('../../scripts/source-patched/shared/apply-patches.mts'),
  () => ({ applySocketPatches: io.patches }),
)

const config = {
  arch: 'arm64',
  buildDir: '/example/build',
  buildMode: 'prod',
  buildPatchesDir: '/example/build/patches',
  cacheDir: '/example/cache',
  cleanBuild: false,
  collectBuildSourceFiles: io.collect,
  isProdBuild: true,
  libc: 'musl',
  modeSourceDir: '/example/source',
  nodeBinary: '/example/source/node',
  nodeRepo: 'https://example.invalid/node',
  nodeVersion: '26.0.0',
  outDir: '/example/source/out',
  outputReleaseBinary: '/example/release/node',
  outputReleaseDir: '/example/release',
  packageName: 'example-node',
  packageRoot: '/example/package',
  platform: 'linux',
  sharedBuildDir: '/example/shared',
  sharedSourceDir: '/example/shared/source',
}
beforeEach(() => {
  vi.resetAllMocks()
  io.events = []
  io.windows = false
  for (const [name, effect] of Object.entries({
    tools: io.tools,
    environment: io.environment,
    mkdir: io.mkdir,
    clone: io.clone,
    reset: io.reset,
    prepare: io.prepare,
    restore: io.restore,
    additions: io.additions,
    patches: io.patches,
    verify: io.verify,
    compile: io.compile,
  })) {
    effect.mockImplementation(async () => {
      io.events.push(name)
    })
  }
  io.exists.mockReturnValue(true)
  io.checkpoint.mockResolvedValue(false)
  io.cache.mockResolvedValue(true)
  io.collect.mockResolvedValue(['/example/source-input'])
  io.flags.mockResolvedValue({
    configureFlags: ['--without-npm', '--without-inspector'],
    isCrossCompiling: true,
  })
  io.shouldRun.mockResolvedValue(true)
  io.configure.mockResolvedValue({
    configureArgs: ['--without-npm', '--without-inspector'],
    buildEnv: { EXAMPLE_BUILD: 'enabled' },
  })
  io.finalize.mockResolvedValue({
    releaseBinaryPath: '/example/release/node',
    finalized: true,
  })
})

test('valid restored checkpoints return without rebuilding sources', async () => {
  io.checkpoint.mockResolvedValue(true)
  await expect(buildRelease(config)).resolves.toEqual({
    releaseBinaryPath: config.outputReleaseBinary,
  })
  expect(io.events).toEqual(['tools', 'environment', 'mkdir'])
  expect(io.collect).not.toHaveBeenCalled()
  expect(io.clone).not.toHaveBeenCalled()
  expect(io.checkpoint).toHaveBeenCalledWith(
    expect.objectContaining({ checkpointChain: getCheckpointChain('prod') }),
  )
})
test('unchanged inputs reuse only an existing release binary', async () => {
  io.cache.mockResolvedValue(false)
  await expect(buildRelease(config)).resolves.toMatchObject({
    cached: true,
    releaseBinaryPath: config.outputReleaseBinary,
  })
  expect(io.cache).toHaveBeenCalledExactlyOnceWith(config.cacheDir, [
    '/example/source-input',
  ])
  expect(io.clone).not.toHaveBeenCalled()
  expect(io.configure).not.toHaveBeenCalled()
})
test.each([false, true])(
  'fresh build preserves source preparation order with Windows=%s',
  async windows => {
    io.windows = windows
    const build = {
      ...config,
      arch: windows ? 'x64' : 'arm64',
      platform: windows ? 'win32' : 'linux',
      libc: windows ? undefined : 'musl',
      buildMode: windows ? 'dev' : 'prod',
      isProdBuild: !windows,
    }
    await expect(
      buildRelease(build, { skipCheckpoint: true }),
    ).resolves.toMatchObject({ finalized: true })
    expect(io.events).toEqual([
      'tools',
      'environment',
      'mkdir',
      'clone',
      'reset',
      'prepare',
      'restore',
      'additions',
      'patches',
      'verify',
      ...(windows ? [] : ['compile']),
    ])
    expect(io.prepare).toHaveBeenCalledExactlyOnceWith({
      buildMode: build.buildMode,
      platformArch: windows ? 'win32-x64' : 'linux-arm64-musl',
    })
    expect(io.shouldRun).toHaveBeenCalledWith(
      config.buildDir,
      config.packageName,
      'binary-released',
      expect.objectContaining({
        configureFlags: '--without-inspector,--without-npm',
        buildMode: windows ? 'dev' : 'prod',
        sourcePaths: ['/example/source-input'],
      }),
    )
    if (windows) {
      expect(io.compile).not.toHaveBeenCalled()
    } else {
      expect(io.compile).toHaveBeenCalledWith(
        expect.objectContaining({
          jobCount: 7,
          configureArgs: ['--without-npm', '--without-inspector'],
          buildEnv: { EXAMPLE_BUILD: 'enabled' },
        }),
      )
    }
    expect(io.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        skipCheckpoint: true,
        isCrossCompiling: true,
        buildSourcePaths: ['/example/source-input'],
      }),
    )
  },
)
test('clean build bypasses cache lookup but keeps checkpoint freshness validation', async () => {
  io.shouldRun.mockResolvedValue(false)
  await buildRelease({ ...config, cleanBuild: true })
  expect(io.cache).not.toHaveBeenCalled()
  expect(io.collect).toHaveBeenCalledOnce()
  expect(io.configure).not.toHaveBeenCalled()
  expect(io.compile).not.toHaveBeenCalled()
  expect(io.finalize).toHaveBeenCalledWith(
    expect.objectContaining({ skipCheckpoint: false }),
  )
})
test('a missing cached binary forces a build despite unchanged inputs', async () => {
  io.cache.mockResolvedValue(false)
  io.exists.mockReturnValue(false)
  await buildRelease(config)
  expect(io.clone).toHaveBeenCalledOnce()
  expect(io.compile).toHaveBeenCalledOnce()
})
test('configure failures stop compilation and finalization', async () => {
  const failure = new Error('example configuration failed')
  io.configure.mockRejectedValueOnce(failure)
  await expect(buildRelease(config)).rejects.toBe(failure)
  expect(io.compile).not.toHaveBeenCalled()
  expect(io.finalize).not.toHaveBeenCalled()
})
test('missing required configuration rejects before build logging or tools', async () => {
  await expect(buildRelease({ ...config, arch: undefined })).rejects.toThrow(
    Error,
  )
  expect(io.clear).not.toHaveBeenCalled()
  expect(io.tools).not.toHaveBeenCalled()
})
