import { beforeEach, expect, test, vi } from 'vitest'
import {
  compressBinary,
  detectLibc,
  getPlatformConfig,
  isCompressedBinary,
} from '../../scripts/binary-compressed/shared/compress-binary.mts'
import {
  LIBC_VALUES,
  MAGIC_MARKER,
} from '../../scripts/binary-compressed/shared/constants.mts'

const io = vi.hoisted(() => ({
  argv: ['node', 'example-compressor'],
  exists: vi.fn(),
  read: vi.fn(),
  close: vi.fn(),
  spawn: vi.fn(),
  stat: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))
vi.mock(import('node:process'), async original => ({
  ...(await original()),
  default: {
    ...(await original()).default,
    argv: io.argv,
    platform: 'linux',
    exitCode: 0,
  },
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
  promises: {
    ...(await original()).promises,
    stat: io.stat,
    open: async () => ({ read: io.read, close: io.close }),
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
  vi.resetAllMocks()
  io.exists.mockReturnValue(true)
  io.read.mockResolvedValue({ bytesRead: 0 })
  io.stat.mockResolvedValue({ size: 1024 })
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  io.argv.splice(0, io.argv.length, 'node', 'example-compressor')
  const { default: isolatedProcess } = await import('node:process')
  isolatedProcess.platform = 'linux'
  isolatedProcess.exitCode = 0
})

function supplyBinary(content: Buffer) {
  io.read.mockImplementation(
    async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => ({
      bytesRead: content.copy(buffer, offset, position, position + length),
    }),
  )
}

test('rejects absent input before reading or launching compression', async () => {
  io.exists.mockReturnValue(false)
  await expect(
    compressBinary(
      '/example/binpress',
      '/example/input',
      '/example/output',
      { binaryFormat: 'ELF' },
      'arm64',
    ),
  ).rejects.toThrow(Error)
  expect(io.read).not.toHaveBeenCalled()
  expect(io.spawn).not.toHaveBeenCalled()
})

test('preserves already compressed bytes without another compressor invocation', async () => {
  supplyBinary(Buffer.from(MAGIC_MARKER))
  await compressBinary(
    '/example/binpress',
    '/example/input',
    '/example/output',
    { binaryFormat: 'ELF' },
    'arm64',
  )
  expect(io.spawn).not.toHaveBeenCalled()
  expect(io.stat).not.toHaveBeenCalled()
  expect(io.close).toHaveBeenCalledOnce()
})

test('detects a compression marker spanning read windows', async () => {
  supplyBinary(
    Buffer.concat([Buffer.alloc(4096 - 3), Buffer.from(MAGIC_MARKER)]),
  )
  await expect(isCompressedBinary('/example/input')).resolves.toBe(true)
  expect(io.read).toHaveBeenCalledTimes(2)
  expect(io.close).toHaveBeenCalledOnce()
})

test('bounds marker scanning and closes a marker-free binary', async () => {
  supplyBinary(Buffer.alloc(6 * 1024 * 1024))
  await expect(isCompressedBinary('/example/input')).resolves.toBe(false)
  expect(io.read).toHaveBeenCalledTimes(1281)
  expect(io.close).toHaveBeenCalledOnce()
})

test('closes the input after a read failure', async () => {
  io.read.mockRejectedValue(
    Object.assign(new Error('Fixture read failed'), { code: 'EIO' }),
  )
  await expect(isCompressedBinary('/example/input')).resolves.toBe(false)
  expect(io.close).toHaveBeenCalledOnce()
})

test.each([
  ['musl libc.so', LIBC_VALUES.musl],
  ['libc.so', LIBC_VALUES.glibc],
  ['glibc', LIBC_VALUES.glibc],
  ['unknown loader', LIBC_VALUES.glibc],
])('classifies libc probe output %s', async (stdout, expected) => {
  io.spawn.mockResolvedValue({ code: 0, stdout, stderr: '' })
  await expect(detectLibc('/example/input')).resolves.toBe(expected)
})

test('returns the documented libc fallback after a rejected probe', async () => {
  io.spawn.mockRejectedValue(
    Object.assign(new Error('Fixture ldd unavailable'), { code: 'ENOENT' }),
  )
  await expect(detectLibc('/example/input')).resolves.toBe(LIBC_VALUES.glibc)
})

test('rejects unsupported host binary formats', async () => {
  const { default: isolatedProcess } = await import('node:process')
  isolatedProcess.platform = 'freebsd'
  expect(() => getPlatformConfig()).toThrow(Error)
})

test.each(['missing-tool-argument', 'missing-tool-file', 'no-libc-override'])(
  'CLI handles %s without unexpected process work',
  async scenario => {
    vi.resetModules()
    io.argv.push('/example/input', '/example/output')
    if (scenario !== 'missing-tool-argument') {
      io.argv.push('--binpress-path=/example/binpress')
    }
    if (scenario === 'missing-tool-file') {
      io.exists.mockReturnValue(false)
    }
    await import('../../scripts/binary-compressed/shared/compress-binary.mts')
    await vi.waitFor(() => {
      if (scenario === 'no-libc-override') {
        expect(io.success).toHaveBeenCalledOnce()
        expect(io.spawn.mock.calls[0]?.[1]).not.toContain('--target-libc')
      } else {
        expect(io.error).toHaveBeenCalledOnce()
        expect(io.spawn).not.toHaveBeenCalled()
      }
    })
  },
)
