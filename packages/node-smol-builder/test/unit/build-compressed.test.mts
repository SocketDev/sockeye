import { beforeEach, expect, test, vi } from 'vitest'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import process from 'node:process'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { adHocSign } from 'local-build-infra/lib/sign'
import { ensureBinpress } from '../../scripts/common/shared/compression-tools.mts'
import { buildCompressed } from '../../scripts/binary-compressed/shared/build-compressed.mts'
const io = vi.hoisted(() => ({
  checkpoint: vi.fn(),
  exec: vi.fn(),
  size: vi.fn(),
  smoke: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  promises: {
    ...(await original()).promises,
    readdir: vi.fn(),
    readFile: vi.fn(),
  },
}))
vi.mock(import('../../scripts/binary-compressed/shared/paths.mts'), () => ({
  PACKAGE_ROOT: '/example/package',
  COMPRESS_BINARY_SCRIPT: '/example/package/compress.mts',
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.exec,
}))
vi.mock(import('local-build-infra/lib/build-operations'), async original => ({
  ...(await original()),
  createCheckpoint: io.checkpoint,
  getFileSize: io.size,
  smokeTestBinary: io.smoke,
}))
vi.mock(import('local-build-infra/lib/sign'), () => ({ adHocSign: vi.fn() }))
vi.mock(import('../../scripts/common/shared/compression-tools.mts'), () => ({
  ensureBinpress: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(),
  safeMkdir: vi.fn(),
}))
const config = {
  arch: 'arm64',
  buildDir: '/example/build',
  buildSourcePaths: ['/example/source'],
  isCrossCompiling: false,
  isProdBuild: true,
  libc: 'musl',
  nodeVersion: '24.0.0',
  outputCompressedBinary: '/example/build/compressed/node',
  outputCompressedDir: '/example/build/compressed',
  outputStrippedBinary: '/example/build/stripped/node',
  packageName: 'example-node',
  platform: 'linux',
  withLief: false,
}
beforeEach(() => {
  vi.resetAllMocks()
  io.exec.mockResolvedValue({ code: 0, stdout: '', stderr: '', pid: 0 })
  io.size.mockResolvedValue('10M')
  io.smoke.mockResolvedValue(true)
  io.checkpoint.mockImplementation(async (dir, name, validate) => {
    await validate()
  })
  vi.mocked(ensureBinpress).mockResolvedValue('/example/binpress')
  vi.mocked(adHocSign).mockImplementation(async (binary, onSign) => {
    await onSign?.()
  })
  vi.mocked(fs.readdir).mockResolvedValue(['node', 'stale.o'])
  vi.mocked(fs.readFile).mockResolvedValue(
    Buffer.from('fixture compressed binary'),
  )
})
test.each([
  'arch',
  'buildDir',
  'outputCompressedBinary',
  'outputCompressedDir',
  'outputStrippedBinary',
  'platform',
])('rejects missing %s before finding binpress', async key => {
  await expect(
    buildCompressed({ ...config, [key]: undefined }),
  ).rejects.toThrow()
  expect(ensureBinpress).not.toHaveBeenCalled()
  expect(io.exec).not.toHaveBeenCalled()
})
test.each([true, false])(
  'compresses with exact target and checkpoint metadata, cross=%s',
  async cross => {
    expect(
      await buildCompressed({
        ...config,
        isCrossCompiling: cross,
        isProdBuild: !cross,
        libc: cross ? 'musl' : undefined,
      }),
    ).toEqual({ compressed: true })
    const args = [
      '/example/package/compress.mts',
      config.outputStrippedBinary,
      config.outputCompressedBinary,
      '--quality=zstd',
      '--target-arch=arm64',
      '--binpress-path=/example/binpress',
      ...(cross ? ['--target-libc=musl'] : []),
    ]
    expect(io.exec).toHaveBeenCalledExactlyOnceWith(process.execPath, args, {
      cwd: '/example/package',
      stdio: 'inherit',
    })
    expect(adHocSign).toHaveBeenCalledWith(
      config.outputCompressedBinary,
      expect.any(Function),
    )
    expect(safeDelete).toHaveBeenCalledExactlyOnceWith(
      '/example/build/compressed/stale.o',
    )
    expect(io.checkpoint.mock.calls[0]?.[3]).toMatchObject({
      checksum: crypto
        .createHash('sha256')
        .update('fixture compressed binary')
        .digest('hex'),
      binaryPath: 'compressed/node',
      artifactPath: config.outputCompressedDir,
      buildMode: cross ? 'dev' : 'prod',
      sourcePaths: config.buildSourcePaths,
    })
    expect(io.smoke).toHaveBeenCalledExactlyOnceWith(
      config.outputCompressedBinary,
      { arch: cross ? 'arm64' : undefined, libc: cross ? 'musl' : undefined },
    )
  },
)
test('skips checkpoint cleanup and hashing when explicitly disabled', async () => {
  expect(await buildCompressed(config, { skipCheckpoint: true })).toEqual({
    compressed: true,
  })
  expect(io.checkpoint).not.toHaveBeenCalled()
  expect(fs.readdir).not.toHaveBeenCalled()
  expect(fs.readFile).not.toHaveBeenCalled()
  expect(io.exec).toHaveBeenCalledTimes(1)
})
test('rejects a failed smoke test instead of completing the checkpoint', async () => {
  io.smoke.mockResolvedValue(false)
  await expect(buildCompressed(config)).rejects.toThrow()
})
test('propagates compression failure before signing or checkpoint creation', async () => {
  const failure = new Error('fixture compression failure')
  io.exec.mockRejectedValue(failure)
  await expect(buildCompressed(config)).rejects.toBe(failure)
  expect(adHocSign).not.toHaveBeenCalled()
  expect(io.checkpoint).not.toHaveBeenCalled()
})
