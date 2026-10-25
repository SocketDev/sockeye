import { afterEach, expect, test, vi } from 'vitest'
import { buildRelease } from '../../scripts/binary-released/shared/build-released.mts'

const start = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('example unexpected build operation')
  }),
)
vi.mock(import('local-build-infra/lib/build-operations'), () => ({
  clearBuildLog: start,
  needsCacheRebuild: start,
  saveBuildLog: start,
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), () => ({
  shouldRun: start,
}))
vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  getCurrentPlatformArch: start,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeMkdir: start,
}))
vi.mock(
  import('../../scripts/binary-released/shared/copy-additions.mts'),
  () => ({
    copyBuildAdditions: start,
  }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-configure.mts'),
  () => ({
    getReleaseConfigureFlags: start,
  }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-artifact.mts'),
  () => ({
    finalizeReleaseBinary: start,
  }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-checkpoints.mts'),
  () => ({
    inspectReleaseCheckpoints: start,
  }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-compile.mts'),
  () => ({
    compileReleaseBinary: start,
    configureReleaseBinary: start,
  }),
)
vi.mock(
  import('../../scripts/binary-released/shared/release-source.mts'),
  () => ({
    resetReleaseSource: start,
    restoreReleaseSource: start,
    verifyReleaseSource: start,
  }),
)
vi.mock(import('../../scripts/binary-released/shared/paths.mts'), () => ({
  PATCHES_SOURCE_PATCHED_DIR: '/example/patches',
}))
vi.mock(
  import('../../scripts/binary-released/shared/preflight-checks.mts'),
  () => ({
    checkBuildEnvironment: start,
    checkRequiredTools: start,
  }),
)
vi.mock(
  import('../../scripts/binary-released/shared/prepare-external-sources.mts'),
  () => ({ prepareExternalSources: start }),
)
vi.mock(import('../../scripts/source-copied/shared/copy-source.mts'), () => ({
  cloneNodeSource: start,
}))
vi.mock(
  import('../../scripts/source-patched/shared/apply-patches.mts'),
  () => ({
    applySocketPatches: start,
  }),
)
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ log: vi.fn() }),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
test.each(['2jobs', '1.5', '9007199254740992'])(
  'release rejects malformed BUILD_JOBS=%s before any build effects',
  async value => {
    vi.stubEnv('BUILD_JOBS', value)
    const config = {
      arch: 'arm64',
      buildDir: '/example/build',
      buildMode: 'prod',
      modeSourceDir: '/example/source',
      nodeBinary: '/example/node',
      nodeRepo: 'https://example.invalid/node',
      nodeVersion: '26.0.0',
      outDir: '/example/out',
      outputReleaseBinary: '/example/release/node',
      outputReleaseDir: '/example/release',
      packageRoot: '/example/package',
      platform: 'darwin',
      sharedBuildDir: '/example/shared',
      sharedSourceDir: '/example/shared/source',
    }
    await expect(buildRelease(config)).rejects.toThrow(Error)
    expect(start).not.toHaveBeenCalled()
  },
)
