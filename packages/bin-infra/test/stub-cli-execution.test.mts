import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  stub: vi.fn(),
  platform: vi.fn(),
  run: vi.fn(),
  checkpoint: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  fail: vi.fn(),
  error: vi.fn(),
  hint: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    existsSync: io.exists,
    promises: { ...actual.promises, stat: io.stat },
  }
})
vi.mock(import('local-build-infra/lib/constants'), () => ({
  CHECKPOINT_CHAINS: { simple: () => ['finalized'] },
  CHECKPOINTS: { FINALIZED: 'finalized' },
  getBuildMode: () => 'prod',
  getPlatformBuildDir: () => '/example/build',
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), () => ({
  createCheckpoint: io.checkpoint,
  shouldRun: io.run,
}))
vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  tarSupportsNoAbsoluteNames: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/release-checksums/core'), () => ({
  verifyReleaseChecksum: vi.fn(),
}))
vi.mock(import('local-curl-builder/lib/ensure-curl'), () => ({
  ensureCurl: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/github-error-utils'), () => ({
  logTransientErrorHelp: io.hint,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeMkdir: io.mkdir,
  safeDelete: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/env/ci'), () => ({
  getCI: () => false,
}))
vi.mock(import('@socketsecurity/lib-stable/releases/socket-btm'), () => ({
  downloadSocketBtmRelease: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    info: io.info,
    success: io.success,
    fail: io.fail,
    error: io.error,
  }),
}))
vi.mock(import('../lib/build-stubs-properties.mts'), () => ({
  getCurrentStubPlatformArch: io.platform,
  getMakefileName: () => 'Makefile.linux',
  getStubBinaryName: () => 'smol_stub',
  getStubOutDir: () => '/example/stubs',
  stubDir: '/example/stub-source',
  stubExistsAt: io.stub,
  parsePlatformArch: (value: string) => ({
    platform: 'linux',
    arch: 'x64',
    libc: value.endsWith('-musl') ? 'musl' : undefined,
  }),
}))
const originalArgv = process.argv
const originalExitCode = process.exitCode
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  process.exitCode = 0
  io.exists.mockReturnValue(true)
  io.stub.mockReturnValue(true)
  io.platform.mockResolvedValue('linux-x64')
  io.run.mockResolvedValue(true)
  io.stat.mockResolvedValue(
    Object.assign(statSync(new URL(import.meta.url)), { size: 1024 }),
  )
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  io.checkpoint.mockImplementation(async (directory, stage, verify) => {
    await verify()
  })
})
afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
})
async function runStubCli(args: string[] = []) {
  process.argv = [
    process.execPath,
    fileURLToPath(new URL('../lib/build-stubs.mts', import.meta.url)),
    ...args,
  ]
  await import('../lib/build-stubs.mts')
}

test('complete checkpoints with a present artifact skip all work', async () => {
  io.run.mockResolvedValue(false)
  await runStubCli()
  await vi.waitFor(() =>
    expect(io.success).toHaveBeenCalledWith(
      'Stub already built (finalized checkpoint exists)',
    ),
  )
  expect(io.checkpoint).not.toHaveBeenCalled()
  expect(io.stat).not.toHaveBeenCalled()
})

test.each(['linux-x64', 'linux-x64-musl'])(
  'creates a verified checkpoint with explicit target metadata for %s',
  async target => {
    io.platform.mockResolvedValue(target)
    await runStubCli()
    await vi.waitFor(() => expect(io.stat).toHaveBeenCalledTimes(2))
    expect(io.checkpoint).toHaveBeenCalledWith(
      '/example/build',
      'finalized',
      expect.any(Function),
      expect.objectContaining({
        platform: 'linux',
        arch: 'x64',
        platformArch: target,
        checkpointChain: ['finalized'],
        stubSize: 1024,
        stubSizeKB: '1.00',
      }),
    )
    expect(io.mkdir).toHaveBeenCalledWith('/example/build')
    expect(io.spawn).not.toHaveBeenCalled()
  },
)

test('stale checkpoints rebuild absent artifacts and validate oversized output', async () => {
  io.run.mockResolvedValue(false)
  io.stub
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(false)
    .mockReturnValue(true)
  io.stat.mockResolvedValue(
    Object.assign(statSync(new URL(import.meta.url)), { size: 250_000 }),
  )
  await runStubCli()
  await vi.waitFor(() => expect(io.stat).toHaveBeenCalledTimes(2))
  expect(io.info).toHaveBeenCalledWith(
    'Checkpoint exists but stub binary missing, rebuilding from scratch',
  )
  expect(io.info).toHaveBeenCalledWith(
    'Warning: Stub is larger than expected: 250000 bytes',
  )
})

test('force is forwarded to checkpoint evaluation', async () => {
  io.run.mockRejectedValue(new Error('fixture checkpoint rejected'))
  await runStubCli(['--force'])
  await vi.waitFor(() => expect(process.exitCode).toBe(1))
  expect(io.run).toHaveBeenCalledWith('/example/build', '', 'finalized', {
    force: true,
  })
  expect(io.hint).toHaveBeenCalledOnce()
  expect(io.checkpoint).not.toHaveBeenCalled()
})

test('diagnostic helper failure preserves the original CLI failure', async () => {
  io.platform.mockRejectedValue(new Error('fixture target rejected'))
  io.hint.mockRejectedValue(new Error('fixture diagnostic rejected'))
  await runStubCli()
  await vi.waitFor(() => expect(process.exitCode).toBe(1))
  expect(io.fail).toHaveBeenCalledOnce()
  expect(io.error).toHaveBeenCalledOnce()
})
