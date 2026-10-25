import { beforeEach, expect, test, vi } from 'vitest'

import { compressBinary } from '../../scripts/binary-compressed/shared/compress-binary.mts'

const io = vi.hoisted(() => ({
  argv: ['node', 'example-compressor'],
  spawn: vi.fn(),
  stat: vi.fn(),
  success: vi.fn(),
  close: vi.fn(),
  error: vi.fn(),
}))
vi.mock(import('node:process'), async original => ({
  ...(await original()),
  default: {
    ...(await original()).default,
    argv: io.argv,
    platform: 'linux',
    arch: 'arm64',
    exitCode: 0,
  },
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: () => true,
  promises: {
    ...(await original()).promises,
    stat: io.stat,
    open: async () => ({
      read: async () => ({ bytesRead: 0 }),
      close: io.close,
    }),
  },
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: io.error,
    success: io.success,
  }),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  io.argv.splice(0, io.argv.length, 'node', 'example-compressor')
  const { default: isolatedProcess } = await import('node:process')
  isolatedProcess.exitCode = 0
  io.stat.mockResolvedValue({ size: 1024 })
  io.spawn.mockResolvedValue({ code: 0 })
})

test.each([false, true])(
  'CLI reports compression failure=%s through its exit status',
  async fails => {
    vi.resetModules()
    io.argv.splice(
      0,
      io.argv.length,
      'node',
      'example-compressor',
      '/example/input',
      '/example/output',
      '--binpress-path=/example/binpress',
      '--target-arch=arm64',
      '--target-libc=musl',
    )
    if (fails) {
      io.spawn.mockRejectedValue(
        Object.assign(new Error('Fixture compression signal'), {
          // oxlint-disable-next-line socket/prefer-undefined-over-null -- Node reports a null exit code when a signal terminates the child.
          code: null,
          signal: 'SIGTERM',
        }),
      )
    }
    await import('../../scripts/binary-compressed/shared/compress-binary.mts')
    const { default: isolatedProcess } = await import('node:process')
    await vi.waitFor(() => {
      if (fails) {
        expect(io.error).toHaveBeenCalledOnce()
        expect(isolatedProcess.exitCode).toBe(1)
        expect(io.success).not.toHaveBeenCalled()
      } else {
        expect(io.success).toHaveBeenCalledOnce()
        expect(isolatedProcess.exitCode).toBe(0)
      }
    })
  },
)

test.each([
  Object.assign(new Error('Fixture compressor terminated'), {
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- Node reports a null exit code when a signal terminates the child.
    code: null,
    signal: 'SIGTERM',
  }),
  new Error('Fixture compressor failed before launching'),
])(
  'propagates compression rejection without reporting output: %s',
  async failure => {
    io.spawn.mockRejectedValue(failure)
    await expect(
      compressBinary(
        '/example/binpress',
        '/example/input',
        '/example/output',
        { binaryFormat: 'ELF' },
        'arm64',
        'musl',
      ),
    ).rejects.toBe(failure)
    expect(io.stat).toHaveBeenCalledExactlyOnceWith('/example/input')
    expect(io.close).toHaveBeenCalledOnce()
    expect(io.success).not.toHaveBeenCalled()
  },
)

test('reports output only after a successful compressor exit', async () => {
  await compressBinary(
    '/example/binpress',
    '/example/input',
    '/example/output',
    { binaryFormat: 'ELF' },
    'arm64',
    'musl',
  )
  expect(io.spawn).toHaveBeenCalledExactlyOnceWith(
    '/example/binpress',
    [
      '/example/input',
      '-o',
      '/example/output',
      '--target-platform',
      'linux',
      '--target-arch',
      'arm64',
      '--target-libc',
      'musl',
    ],
    { stdio: 'inherit' },
  )
  expect(io.stat).toHaveBeenLastCalledWith('/example/output')
  expect(io.success).toHaveBeenCalledOnce()
})
