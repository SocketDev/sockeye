import crypto from 'node:crypto'
import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const io = vi.hoisted(() => ({
  read: vi.fn(),
  mkdir: vi.fn(),
  copy: vi.fn(),
  write: vi.fn(),
  stdout: vi.fn(() => true),
  stderr: vi.fn(() => true),
}))
vi.mock(import('node:fs/promises'), () => ({
  readFile: io.read,
  mkdir: io.mkdir,
  copyFile: io.copy,
  writeFile: io.write,
}))
const savedArguments = process.argv
const savedExitCode = process.exitCode
const modules = [
  {
    name: 'addon',
    asset: 'keychain-addon-1.2.3-darwin-arm64.node',
    load: () => import('../scripts/stage-release.mts'),
  },
  {
    name: 'cli',
    asset: 'socket-keychain-1.2.3-darwin-arm64',
    load: () => import('../../keychain-cli-builder/scripts/stage-release.mts'),
  },
]
let bytes: Buffer
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  bytes = Buffer.alloc(1024)
  bytes.writeUInt32LE(0xfe_ed_fa_cf, 0)
  bytes.writeUInt32LE(0x01_00_00_0c, 4)
  io.read.mockResolvedValue(bytes)
  io.mkdir.mockResolvedValue(undefined)
  io.copy.mockResolvedValue(undefined)
  io.write.mockResolvedValue(undefined)
  vi.spyOn(process.stdout, 'write').mockImplementation(io.stdout)
  vi.spyOn(process.stderr, 'write').mockImplementation(io.stderr)
  process.exitCode = undefined
})
afterEach(() => {
  process.argv = savedArguments
  process.exitCode = savedExitCode
  vi.restoreAllMocks()
})

test.each(modules)(
  '$name stages the validated bytes with a SHA256 sidecar',
  async module => {
    process.argv = [
      'node',
      '/example/stage-release.mts',
      '1.2.3',
      'darwin-arm64',
      '/example/input',
      '/example/staged',
    ]
    await module.load()
    await vi.waitFor(() => expect(io.stdout).toHaveBeenCalled())
    const output = `/example/staged/${module.asset}`
    expect(io.read).toHaveBeenCalledExactlyOnceWith('/example/input')
    expect(io.mkdir).toHaveBeenCalledExactlyOnceWith('/example/staged', {
      recursive: true,
    })
    expect(io.copy).toHaveBeenCalledExactlyOnceWith('/example/input', output)
    expect(io.write).toHaveBeenCalledExactlyOnceWith(
      `${output}.sha256`,
      `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${module.asset}\n`,
    )
    expect(io.stdout).toHaveBeenCalledExactlyOnceWith(`${output}\n`)
    expect(io.stderr).not.toHaveBeenCalled()
  },
)

test.each(modules)(
  '$name refuses missing arguments before reading input',
  async module => {
    process.argv = ['node', '/example/stage-release.mts']
    await module.load()
    await vi.waitFor(() => expect(process.exitCode).toBe(1))
    expect(io.read).not.toHaveBeenCalled()
    expect(io.mkdir).not.toHaveBeenCalled()
    expect(io.stdout).not.toHaveBeenCalled()
    expect(io.stderr).toHaveBeenCalledOnce()
  },
)

test.each(modules)(
  '$name refuses architecture mismatch before creating output',
  async module => {
    process.argv = [
      'node',
      '/example/stage-release.mts',
      '1.2.3',
      'darwin-x64',
      '/example/input',
      '/example/staged',
    ]
    await module.load()
    await vi.waitFor(() => expect(process.exitCode).toBe(1))
    expect(io.mkdir).not.toHaveBeenCalled()
    expect(io.copy).not.toHaveBeenCalled()
    expect(io.write).not.toHaveBeenCalled()
  },
)

test.each(modules)(
  '$name reports read errors without staging an artifact',
  async module => {
    process.argv = [
      'node',
      '/example/stage-release.mts',
      '1.2.3',
      'darwin-arm64',
      '/example/input',
      '/example/staged',
    ]
    io.read.mockRejectedValueOnce(
      Object.assign(new Error('example input unavailable'), { code: 'ENOENT' }),
    )
    await module.load()
    await vi.waitFor(() => expect(process.exitCode).toBe(1))
    expect(io.mkdir).not.toHaveBeenCalled()
    expect(io.stdout).not.toHaveBeenCalled()
  },
)
