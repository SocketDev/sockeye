import { beforeEach, expect, test, vi } from 'vitest'

const io = vi.hoisted(() => ({
  exists: vi.fn(),
  parse: vi.fn(),
  checksum: vi.fn(),
  release: vi.fn(),
  stripped: vi.fn(),
  compressed: vi.fn(),
  finalize: vi.fn(),
  summary: vi.fn(),
  collect: vi.fn(),
  writeHash: vi.fn(),
  current: vi.fn(),
  checkpoint: vi.fn(),
  log: vi.fn(),
  paths: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(import('local-build-infra/lib/build-operations'), () => ({
  formatDuration: () => '1 second',
  getFileSize: vi.fn().mockResolvedValue('10 MB'),
  writeCacheHash: io.writeHash,
}))
vi.mock(import('local-build-infra/lib/checkpoint-cache-key'), () => ({
  computeBuildInputsFingerprint: () => 'current-fingerprint',
  formatStaleCheckpointMessage: () => 'Fixture stale checkpoint',
  isCheckpointFingerprintCurrent: io.current,
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), () => ({
  getCheckpointData: io.checkpoint,
}))
vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  getCurrentPlatformArch: async () => 'darwin-arm64',
}))
vi.mock(import('local-build-infra/lib/version-metadata'), () => ({
  verifyNodeChecksum: io.checksum,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    step: vi.fn(),
    success: vi.fn(),
    log: io.log,
    warn: vi.fn(),
    fail: vi.fn(),
    skip: vi.fn(),
    logNewline: vi.fn(),
  }),
}))
vi.mock(
  import('../../scripts/common/shared/collect-build-source-files.mts'),
  () => ({ collectBuildSourceFiles: io.collect }),
)
vi.mock(import('../../scripts/common/shared/parse-build-args.mts'), () => ({
  calculateCpuCount: () => 4,
  parseBuildArgs: io.parse,
}))
vi.mock(import('../../scripts/common/shared/paths.mts'), () => ({
  PACKAGE_ROOT: '/example/node',
  getBuildPaths: io.paths,
  getSharedBuildPaths: () => ({
    buildDir: '/example/shared',
    nodeSourceDir: '/example/shared/node',
  }),
  getReleaseCheckpointPaths: (root, phase) => ({
    metadata: `${root}/checkpoints/${phase}.json`,
  }),
}))
vi.mock(
  import('../../scripts/binary-released/shared/build-released.mts'),
  () => ({ buildRelease: io.release }),
)
vi.mock(
  import('../../scripts/binary-stripped/shared/build-stripped.mts'),
  () => ({ buildStripped: io.stripped }),
)
vi.mock(
  import('../../scripts/binary-compressed/shared/build-compressed.mts'),
  () => ({ buildCompressed: io.compressed }),
)
vi.mock(import('../../scripts/finalized/shared/finalize-binary.mts'), () => ({
  finalizeBinary: io.finalize,
}))
vi.mock(import('../../scripts/lib/build-summary.mts'), () => ({
  printBuildSummary: io.summary,
}))
const paths = {
  binaryName: 'node',
  bootstrapFile: '/example/bootstrap',
  buildDir: '/example/build',
  buildPatchesDir: '/example/patches',
  cacheDir: '/example/cache',
  nodeBinary: '/example/node/source/node',
  nodeSourceDir: '/example/source',
  outDir: '/example/out',
  outputCompressedBinary: '/example/compressed/node',
  outputCompressedDir: '/example/compressed',
  outputFinalBinary: '/example/final/node',
  outputReleaseBinary: '/example/release/node',
  outputReleaseDir: '/example/release',
  outputStrippedBinary: '/example/stripped/node',
  outputStrippedDir: '/example/stripped',
  patchedFile: '/example/patched',
  testFile: '/example/test',
}
const args = {
  ARCH: 'arm64',
  AUTO_YES: false,
  BUILD_MODE: 'prod',
  BUILD_ONLY: undefined,
  CLEAN_BUILD: false,
  EXTRA_CONFIGURE_FLAGS: [],
  FROM_CHECKPOINT: undefined,
  IS_CI: false,
  IS_PROD_BUILD: true,
  NODE_REPO: 'https://example.invalid/node',
  NODE_SHA: 'example-sha',
  STOP_AT: undefined,
  TARGET_ARCH: 'arm64',
  TARGET_LIBC: undefined,
  TARGET_PLATFORM: 'darwin',
  values: {},
  WITH_DAWN: false,
  WITH_LIEF: false,
}
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  io.exists.mockReturnValue(false)
  io.parse.mockReturnValue(args)
  io.paths.mockReturnValue(paths)
  io.checksum.mockResolvedValue({ valid: true, version: '24.0.0' })
  io.release.mockResolvedValue({ cached: false, isCrossCompiling: false })
  io.stripped.mockResolvedValue(undefined)
  io.compressed.mockResolvedValue({ compressed: true })
  io.finalize.mockResolvedValue(undefined)
  io.collect.mockImplementation(async phase => [`/example/input/${phase}.mts`])
  io.writeHash.mockResolvedValue(undefined)
  io.current.mockReturnValue(false)
  io.checkpoint.mockResolvedValue({ inputsFingerprint: 'old-fingerprint' })
})
async function runBuildToSummary() {
  await import('../../scripts/common/shared/build.mts')
  await vi.waitUntil(() => io.summary.mock.calls.length === 1)
}
test('runs all phases and writes the cache hash before finalization', async () => {
  await runBuildToSummary()
  expect(io.summary).toHaveBeenCalledOnce()
  expect(io.release).toHaveBeenCalledWith(
    expect.objectContaining({
      buildMode: 'prod',
      platform: 'darwin',
      arch: 'arm64',
    }),
    { skipCheckpoint: false },
  )
  const releaseOptions = io.release.mock.calls[0][0]
  expect(await releaseOptions.collectBuildSourceFiles()).toEqual([
    '/example/input/binary-released.mts',
  ])
  expect(io.stripped).toHaveBeenCalledOnce()
  expect(io.compressed).toHaveBeenCalledOnce()
  expect(io.writeHash).toHaveBeenCalledWith('/example/cache', [
    '/example/input/finalized.mts',
  ])
  expect(io.writeHash.mock.invocationCallOrder[0]).toBeLessThan(
    io.finalize.mock.invocationCallOrder[0],
  )
  expect(io.finalize).toHaveBeenCalledWith(
    expect.objectContaining({
      compressed: true,
      forceRebuild: false,
      outputFinalBinary: paths.outputFinalBinary,
    }),
  )
  expect(io.summary).toHaveBeenCalledWith(
    expect.objectContaining({
      binarySize: '10 MB',
      cpuCount: 4,
      finalBinary: paths.outputFinalBinary,
    }),
  )
})
test.each(['binary-released', 'binary-stripped', 'binary-compressed'])(
  'stops at requested phase %s',
  async phase => {
    io.parse.mockReturnValue({ ...args, STOP_AT: phase, BUILD_ONLY: phase })
    await import('../../scripts/common/shared/build.mts')
    await vi.waitFor(() =>
      expect(io.log).toHaveBeenCalledWith(expect.stringContaining('binary:')),
    )
    expect(io.finalize).not.toHaveBeenCalled()
    expect(io.summary).not.toHaveBeenCalled()
    expect(io.release).toHaveBeenCalledWith(expect.any(Object), {
      skipCheckpoint: phase === 'binary-released',
    })
    expect(io.stripped).toHaveBeenCalledTimes(
      phase === 'binary-released' ? 0 : 1,
    )
    expect(io.compressed).toHaveBeenCalledTimes(
      phase === 'binary-compressed' ? 1 : 0,
    )
  },
)
test.each(['binary-released', 'binary-compressed', 'finalized'])(
  'resumes %s without rerunning completed phases',
  async phase => {
    io.parse.mockReturnValue({
      ...args,
      FROM_CHECKPOINT: phase,
      values: { 'platform-arch': 'linux-x64' },
    })
    io.exists.mockImplementation(
      filename => filename !== paths.outputFinalBinary,
    )
    await runBuildToSummary()
    expect(io.summary).toHaveBeenCalledOnce()
    expect(io.release).not.toHaveBeenCalled()
    expect(io.stripped).toHaveBeenCalledTimes(
      phase === 'binary-released' ? 1 : 0,
    )
    expect(io.compressed).toHaveBeenCalledTimes(phase === 'finalized' ? 0 : 1)
    expect(io.paths).toHaveBeenCalledWith('prod', 'darwin', 'linux-x64')
  },
)
test('reuses a finalized artifact only with a current fingerprint', async () => {
  io.exists.mockReturnValue(true)
  io.current.mockReturnValue(true)
  await runBuildToSummary()
  expect(io.summary).toHaveBeenCalledOnce()
  expect(io.stripped).not.toHaveBeenCalled()
  expect(io.compressed).not.toHaveBeenCalled()
  expect(io.finalize).not.toHaveBeenCalled()
  expect(io.current).toHaveBeenCalledWith({
    checkpointData: { inputsFingerprint: 'old-fingerprint' },
    currentFingerprint: 'current-fingerprint',
  })
})
test('rebuilds a stale finalized artifact and preserves uncompressed output choice', async () => {
  io.exists.mockReturnValue(true)
  io.checkpoint.mockResolvedValue(undefined)
  io.compressed.mockResolvedValue({ compressed: false })
  await runBuildToSummary()
  expect(io.summary).toHaveBeenCalledOnce()
  expect(io.finalize).toHaveBeenCalledWith(
    expect.objectContaining({ compressed: false }),
  )
  expect(io.summary).toHaveBeenCalledWith(
    expect.objectContaining({ compressed: false }),
  )
})
