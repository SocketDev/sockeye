import { beforeEach, expect, test, vi } from 'vitest'
import { finalizeReleaseBinary } from '../../scripts/binary-released/shared/release-artifact.mts'

const io = vi.hoisted(() => ({
  copy: vi.fn(),
  entries: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  checkpoint: vi.fn(),
  smoke: vi.fn(),
  size: vi.fn(),
}))
vi.mock(import('node:fs'), async importOriginal => {
  const original = await importOriginal()
  return {
    ...original,
    promises: { ...original.promises, cp: io.copy, readdir: io.entries },
  }
})
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), async importOriginal => ({
  ...(await importOriginal()),
  safeDelete: io.remove,
  safeMkdir: io.mkdir,
}))
vi.mock(
  import('local-build-infra/lib/build-operations'),
  async importOriginal => ({
    ...(await importOriginal()),
    createCheckpoint: io.checkpoint,
    getFileSize: io.size,
    smokeTestBinary: io.smoke,
  }),
)

const config = {
  arch: 'arm64',
  buildDir: '/example/build',
  buildSourcePaths: ['/example/input'],
  configureFlags: ['--without-npm', '--ninja'],
  isCrossCompiling: true,
  isProdBuild: true,
  libc: 'glibc',
  nodeBinary: '/example/source/node',
  outputReleaseBinary: '/example/release/node',
  packageName: 'example-tool',
  packageRoot: '/example/package',
  platform: 'linux',
  skipCheckpoint: false,
  withLief: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  io.entries.mockResolvedValue(['node', 'stale-node'])
  io.smoke.mockResolvedValue(true)
  io.size.mockResolvedValue('25M')
  io.checkpoint.mockImplementation(async (directory, name, validate) =>
    validate(),
  )
})

test('validates and copies the binary before archiving only the release output', async () => {
  await expect(finalizeReleaseBinary(config)).resolves.toEqual({
    buildSourcePaths: ['/example/input'],
    isCrossCompiling: true,
    releaseBinaryPath: '/example/release/node',
  })
  expect(io.copy).toHaveBeenCalledExactlyOnceWith(
    '/example/source/node',
    '/example/release/node',
    { force: true, preserveTimestamps: true },
  )
  expect(io.remove).toHaveBeenCalledExactlyOnceWith(
    '/example/release/stale-node',
  )
  expect(io.smoke.mock.calls).toEqual([
    ['/example/source/node', { arch: 'arm64' }],
    ['/example/release/node', { arch: 'arm64' }],
  ])
  expect(io.checkpoint.mock.calls[0]?.[3]).toEqual(
    expect.objectContaining({
      artifactPath: '/example/release',
      buildMode: 'prod',
      configureFlags: '--ninja,--without-npm',
      sourcePaths: ['/example/input'],
    }),
  )
})

test('refuses an invalid compiled binary before modifying the release output', async () => {
  io.smoke.mockResolvedValue(false)
  await expect(finalizeReleaseBinary(config)).rejects.toThrow()
  expect(io.mkdir).not.toHaveBeenCalled()
  expect(io.copy).not.toHaveBeenCalled()
  expect(io.checkpoint).not.toHaveBeenCalled()
})

test('rejects a copied artifact that fails checkpoint validation', async () => {
  io.smoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  await expect(finalizeReleaseBinary(config)).rejects.toThrow()
})

test('copies without cleanup or checkpoint creation when explicitly skipped', async () => {
  await finalizeReleaseBinary({
    ...config,
    skipCheckpoint: true,
    isCrossCompiling: false,
  })
  expect(io.smoke).toHaveBeenCalledExactlyOnceWith('/example/source/node', {})
  expect(io.copy).toHaveBeenCalledOnce()
  expect(io.entries).not.toHaveBeenCalled()
  expect(io.checkpoint).not.toHaveBeenCalled()
})
