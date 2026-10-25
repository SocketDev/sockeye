import { beforeEach, expect, test, vi } from 'vitest'
import { CHECKPOINTS } from 'local-build-infra/lib/constants'
import { finalizeReleaseBinary } from '../../scripts/binary-released/shared/release-artifact.mts'
import { inspectReleaseCheckpoints } from '../../scripts/binary-released/shared/release-checkpoints.mts'
import {
  appendReleaseConfigureFlags,
  verifyReleaseDawnArtifact,
} from '../../scripts/binary-released/shared/release-configure.mts'
import { resetReleaseSource } from '../../scripts/binary-released/shared/release-source.mts'
const io = vi.hoisted(() => ({
  checkpoint: vi.fn(),
  smoke: vi.fn(),
  size: vi.fn(),
  copy: vi.fn(),
  entries: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
  has: vi.fn(),
  data: vi.fn(),
  fingerprint: vi.fn(),
  shouldRun: vi.fn(),
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    existsSync: file =>
      file === '/example/absent-source' || file === '/example/dawn.a'
        ? false
        : actual.existsSync(file),
    promises: { ...actual.promises, cp: io.copy, readdir: io.entries },
  }
})
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), async original => ({
  ...(await original()),
  safeDelete: io.remove,
  safeMkdir: io.mkdir,
}))
vi.mock(import('local-build-infra/lib/build-operations'), async original => ({
  ...(await original()),
  createCheckpoint: io.checkpoint,
  smokeTestBinary: io.smoke,
  getFileSize: io.size,
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), async original => ({
  ...(await original()),
  hasCheckpoint: io.has,
  getCheckpointData: io.data,
  shouldRun: io.shouldRun,
}))
vi.mock(
  import('local-build-infra/lib/checkpoint-cache-key'),
  async original => ({
    ...(await original()),
    computeBuildInputsFingerprint: io.fingerprint,
  }),
)
vi.mock(import('local-dawn-builder/scripts/paths'), async original => ({
  ...(await original()),
  getBuildPaths: () => ({ outputLibFile: '/example/dawn.a' }),
}))
vi.mock(import('local-build-infra/lib/platform-mappings'), async original => ({
  ...(await original()),
  getCurrentPlatformArch: async () => 'darwin-arm64',
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.entries.mockResolvedValue(['node'])
  io.smoke.mockResolvedValue(true)
  io.size.mockResolvedValue('25M')
  io.checkpoint.mockImplementation(async (directory, name, validate) =>
    validate(),
  )
  io.fingerprint.mockReturnValue('current-inputs')
})
test('development native release validates without cross-target overrides and records dev metadata', async () => {
  await finalizeReleaseBinary({
    arch: 'arm64',
    buildDir: '/example/build',
    buildSourcePaths: [],
    configureFlags: [],
    isCrossCompiling: false,
    isProdBuild: false,
    libc: undefined,
    nodeBinary: '/example/source/node',
    outputReleaseBinary: '/example/release/node',
    packageName: 'example-builder',
    packageRoot: '/example/package',
    platform: 'darwin',
    skipCheckpoint: false,
    withLief: false,
  })
  expect(io.smoke.mock.calls).toEqual([
    ['/example/source/node', {}],
    ['/example/release/node', {}],
  ])
  expect(io.checkpoint.mock.calls[0]?.[3]).toMatchObject({
    buildMode: 'dev',
    artifactPath: '/example/release',
  })
})
test('package-less stale final checkpoint cannot stop a rebuild', async () => {
  io.has.mockReturnValue(true)
  io.data.mockResolvedValue({ inputsFingerprint: 'stale-inputs' })
  expect(
    await inspectReleaseCheckpoints({
      buildDir: '/example/build',
      checkpointChain: [CHECKPOINTS.FINALIZED],
      packageRoot: '/example/package',
      packageName: undefined,
    }),
  ).toBe(false)
})
test('duplicate-only extra configure flags leave the array unchanged', () => {
  const flags = ['--without-npm']
  appendReleaseConfigureFlags(flags, ['--without-npm', '--without-npm'])
  expect(flags).toEqual(['--without-npm'])
})
test('missing development Dawn artifact fails before compilation', async () => {
  await expect(
    verifyReleaseDawnArtifact({ withDawn: true, buildMode: 'dev' }),
  ).rejects.toThrow()
})
test('absent release source does not trigger a reset or checkpoint query', async () => {
  await resetReleaseSource({
    autoYes: true,
    buildDir: '/example/build',
    buildPatchesDir: '/example/patches',
    cleanBuild: false,
    modeSourceDir: '/example/absent-source',
    packageName: 'example-builder',
  })
  expect(io.shouldRun).not.toHaveBeenCalled()
  expect(io.remove).not.toHaveBeenCalled()
})
