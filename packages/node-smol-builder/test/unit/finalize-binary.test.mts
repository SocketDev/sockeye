import { beforeEach, expect, test, vi } from 'vitest'
import { finalizeBinary } from '../../scripts/finalized/shared/finalize-binary.mts'

const io = vi.hoisted(() => ({
  exists: vi.fn(),
  cp: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  run: vi.fn(),
  checkpoint: vi.fn(),
  fingerprint: vi.fn(),
  platform: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
  promises: { ...(await original()).promises, cp: io.cp, stat: io.stat },
}))
vi.mock(import('node:os'), async original => ({
  ...(await original()),
  platform: io.platform,
  default: { ...(await original()).default, platform: io.platform },
}))
vi.mock(import('local-build-infra/lib/build-operations'), () => ({
  getFileSize: vi.fn().mockResolvedValue('12 MB'),
}))
vi.mock(import('local-build-infra/lib/checkpoint-cache-key'), () => ({
  computeBuildInputsFingerprint: io.fingerprint,
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), () => ({
  shouldRun: io.run,
  createCheckpoint: io.checkpoint,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeMkdir: io.mkdir,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    step: vi.fn(),
    log: vi.fn(),
    logNewline: vi.fn(),
    substep: vi.fn(),
    success: vi.fn(),
  }),
}))
vi.mock(import('../../scripts/paths.mts'), () => ({
  PACKAGE_ROOT: '/example/package',
}))
const config = {
  arch: 'arm64',
  buildDir: '/example/build',
  compressed: true,
  forceRebuild: false,
  libc: undefined,
  nodeVersion: '24.0.0',
  outputCompressedBinary: '/example/compressed/node',
  outputFinalBinary: '/example/build/Final/node',
  outputStrippedBinary: '/example/stripped/node',
  platform: 'darwin',
}
beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(true)
  io.run.mockResolvedValue(true)
  io.cp.mockResolvedValue(undefined)
  io.stat.mockResolvedValue({ size: 1024, mode: 0o755 })
  io.platform.mockReturnValue('darwin')
  io.fingerprint.mockReturnValue('example-fingerprint')
  io.checkpoint.mockImplementation(async (directory, name, validate) => {
    await validate()
  })
})
test('skips all writes for a current checkpoint', async () => {
  io.run.mockResolvedValue(false)
  await finalizeBinary(config)
  expect(io.cp).not.toHaveBeenCalled()
  expect(io.mkdir).not.toHaveBeenCalled()
  expect(io.checkpoint).not.toHaveBeenCalled()
  expect(io.run).toHaveBeenCalledWith(
    config.buildDir,
    undefined,
    'finalized',
    expect.objectContaining({
      sourcePaths: [config.outputCompressedBinary],
      arch: 'arm64',
      nodeVersion: '24.0.0',
      force: false,
    }),
  )
})
test.each([true, false])(
  'copies available compressed=%s input and records artifact metadata',
  async compressed => {
    await finalizeBinary({ ...config, compressed })
    expect(io.cp).toHaveBeenCalledExactlyOnceWith(
      compressed ? config.outputCompressedBinary : config.outputStrippedBinary,
      config.outputFinalBinary,
      { force: true, preserveTimestamps: true },
    )
    expect(io.checkpoint).toHaveBeenCalledWith(
      config.buildDir,
      'finalized',
      expect.any(Function),
      expect.objectContaining({
        artifactPath: '/example/build/Final',
        binaryPath: 'Final/node',
        inputsFingerprint: 'example-fingerprint',
        platform: 'darwin',
        arch: 'arm64',
      }),
    )
  },
)
test('falls back to stripped input when compression output is absent', async () => {
  io.exists.mockImplementation(
    filename => filename !== config.outputCompressedBinary,
  )
  await finalizeBinary(config)
  expect(io.cp).toHaveBeenCalledWith(
    config.outputStrippedBinary,
    config.outputFinalBinary,
    expect.any(Object),
  )
})
test.each(['missing', 'empty', 'not-executable'])(
  'rejects invalid final artifact: %s',
  async state => {
    io.exists.mockImplementation(
      filename => state !== 'missing' || filename !== config.outputFinalBinary,
    )
    io.stat.mockResolvedValue({
      size: state === 'empty' ? 0 : 1024,
      mode: state === 'not-executable' ? 0o644 : 0o755,
    })
    await expect(finalizeBinary(config)).rejects.toThrow()
  },
)
test('does not require Unix mode bits on Windows', async () => {
  io.platform.mockReturnValue('win32')
  io.stat.mockResolvedValue({ size: 1024, mode: 0o644 })
  await expect(
    finalizeBinary({ ...config, platform: 'win32' }),
  ).resolves.toBeUndefined()
})
test('does not checkpoint a failed copy', async () => {
  const failure = new Error('Fixture copy failure')
  io.cp.mockRejectedValue(failure)
  await expect(finalizeBinary(config)).rejects.toBe(failure)
  expect(io.checkpoint).not.toHaveBeenCalled()
})
