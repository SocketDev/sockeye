import path from 'node:path'
import process from 'node:process'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  downloadToolIfMissing,
  ensureBinpress,
} from '../../scripts/common/shared/compression-tools.mts'

const io = vi.hoisted(() => ({
  exists: vi.fn(),
  download: vi.fn(),
  hint: vi.fn(),
  env: vi.fn(),
  step: vi.fn(),
  success: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(import('local-build-infra/lib/paths'), () => ({
  getDownloadedDir: () => '/example/downloads',
  getFinalBinaryPath: (root, mode, target, binary) =>
    path.join(root, mode, target, binary),
}))
vi.mock(import('../../scripts/paths.mts'), () => ({
  BINPRESS_DIR: '/example/binpress',
  BUILD_INFRA_DIR: '/example/build-infra',
}))
vi.mock(import('@socketsecurity/lib-stable/releases/socket-btm'), () => ({
  detectLibc: () => undefined,
  downloadSocketBtmRelease: io.download,
}))
vi.mock(import('local-build-infra/lib/github-error-utils'), () => ({
  logTransientErrorHelp: io.hint,
}))
vi.mock(import('@socketsecurity/lib-stable/env/rewire'), () => ({
  getEnvValue: io.env,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    step: io.step,
    success: io.success,
    substep: vi.fn(),
    logNewline: vi.fn(),
  }),
}))
beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(false)
  io.env.mockReturnValue(undefined)
  io.download.mockResolvedValue('/example/downloaded/binpress')
  io.hint.mockResolvedValue(undefined)
})
test.each(['dev', 'prod'])(
  'prefers a matching host %s build without downloading',
  async mode => {
    io.exists.mockImplementation(filename => filename.includes(`/${mode}/`))
    const result = await downloadToolIfMissing(
      'binpress',
      process.platform,
      process.arch,
      undefined,
    )
    expect(result).toContain(`/${mode}/`)
    expect(io.download).not.toHaveBeenCalled()
  },
)
test('uses an existing platform-specific download without network work', async () => {
  io.exists.mockImplementation(filename =>
    filename.startsWith('/example/downloads/'),
  )
  const result = await downloadToolIfMissing(
    'binpress',
    'win32',
    'x64',
    undefined,
  )
  expect(result).toBe('/example/downloads/binpress/win32-x64/binpress.exe')
  expect(io.download).not.toHaveBeenCalled()
})
test.each(['BUILD_ALL_FROM_SOURCE', 'BUILD_TOOLS_FROM_SOURCE'])(
  'refuses release download with %s',
  async name => {
    io.env.mockImplementation(key => (key === name ? '1' : undefined))
    await expect(
      downloadToolIfMissing(
        'binpress',
        process.platform,
        process.arch,
        undefined,
      ),
    ).rejects.toThrow()
    expect(io.download).not.toHaveBeenCalled()
  },
)
test('does not use a local host build for a different target', async () => {
  const platform = process.platform === 'linux' ? 'darwin' : 'linux'
  io.exists.mockImplementation(filename =>
    filename.startsWith('/example/binpress/'),
  )
  await downloadToolIfMissing(
    'binpress',
    platform,
    'x64',
    platform === 'linux' ? 'musl' : undefined,
  )
  expect(io.download).toHaveBeenCalledWith(
    'binpress',
    expect.objectContaining({
      targetPlatform: platform,
      targetArch: 'x64',
      libc: platform === 'linux' ? 'musl' : undefined,
      removeMacOSQuarantine: true,
      cwd: '/example/build-infra',
    }),
  )
})
test('source-only cross-platform request refuses incompatible local builds', async () => {
  io.env.mockReturnValue('1')
  await expect(
    downloadToolIfMissing(
      'binpress',
      process.platform === 'linux' ? 'darwin' : 'linux',
      'x64',
      undefined,
    ),
  ).rejects.toThrow()
  expect(io.download).not.toHaveBeenCalled()
})
test.each([false, true])(
  'preserves original download failure when hint fails=%s',
  async hintFails => {
    const failure = new Error('Fixture release unavailable')
    io.download.mockRejectedValue(failure)
    if (hintFails) {
      io.hint.mockRejectedValue(new Error('Fixture hint unavailable'))
    }
    await expect(
      downloadToolIfMissing('binpress', 'linux', 'x64', 'musl'),
    ).rejects.toBe(failure)
    expect(io.hint).toHaveBeenCalledWith(failure)
  },
)
test.each([false, true])(
  'ensures host compressor with silent=%s',
  async silent => {
    expect(
      await ensureBinpress({
        hostPlatform: 'darwin',
        hostArch: 'arm64',
        silent,
      }),
    ).toBe('/example/downloaded/binpress')
    expect(io.download).toHaveBeenCalledWith(
      'binpress',
      expect.objectContaining({
        targetPlatform: 'darwin',
        targetArch: 'arm64',
        libc: undefined,
      }),
    )
    expect(io.step).toHaveBeenCalledTimes(silent ? 0 : 1)
    expect(io.success).toHaveBeenCalledTimes(silent ? 0 : 1)
  },
)
test('uses runtime host defaults when options are absent', async () => {
  await ensureBinpress(undefined)
  expect(io.download).toHaveBeenCalledWith(
    'binpress',
    expect.objectContaining({
      targetPlatform: process.platform,
      targetArch: process.arch,
    }),
  )
})
