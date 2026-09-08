import { expect, test, vi } from 'vitest'

const io = vi.hoisted(() => ({
  release: vi.fn(),
  strip: vi.fn(),
  paths: vi.fn(),
  parse: vi.fn(),
  shared: vi.fn(),
}))
vi.mock(
  import('../../scripts/binary-released/shared/build-released.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    buildRelease: io.release,
  }),
)
vi.mock(
  import('../../scripts/binary-stripped/shared/build-stripped.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    buildStripped: io.strip,
  }),
)
vi.mock(
  import('../../scripts/common/shared/parse-build-args.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    parseBuildArgs: io.parse,
    calculateCpuCount: () => 2,
  }),
)
vi.mock(
  import('../../scripts/common/shared/paths.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    getBuildPaths: io.paths,
    getSharedBuildPaths: io.shared,
  }),
)
vi.mock(
  import('local-build-infra/lib/version-metadata'),
  async importOriginal => ({
    ...(await importOriginal()),
    verifyNodeChecksum: async () => ({ valid: true, version: '26.0.0' }),
  }),
)

test('build-only compilation forwards the checkpoint opt-out and stops before stripping', async () => {
  io.release.mockResolvedValue({ cached: false, isCrossCompiling: false })
  io.parse.mockReturnValue({
    ARCH: 'arm64',
    BUILD_MODE: 'dev',
    BUILD_ONLY: 'binary-released',
    TARGET_ARCH: 'arm64',
    TARGET_PLATFORM: 'darwin',
    values: { 'platform-arch': 'darwin-arm64' },
  })
  io.paths.mockReturnValue({
    buildDir: '/example/build',
    nodeSourceDir: '/example/source',
    outputReleaseBinary: '/example/release/node',
  })
  io.shared.mockReturnValue({
    buildDir: '/example/shared',
    nodeSourceDir: '/example/pristine',
  })
  await import('../../scripts/common/shared/build.mts')
  await vi.waitFor(() => expect(io.release).toHaveBeenCalledOnce())
  expect(io.release.mock.calls[0]?.[1]).toEqual({ skipCheckpoint: true })
  expect(io.strip).not.toHaveBeenCalled()
})
