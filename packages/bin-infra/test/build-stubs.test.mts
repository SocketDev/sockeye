import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  buildStubFromSource,
  downloadPrebuiltStub,
  ensureStubs,
} from '../lib/build-stubs.mts'

const state = vi.hoisted(() => ({
  ci: false,
  exists: vi.fn(),
  stubExists: vi.fn(),
  spawn: vi.fn(),
  download: vi.fn(),
  checksum: vi.fn(),
  delete: vi.fn(),
  mkdir: vi.fn(),
  curl: vi.fn(),
  tarSupports: vi.fn(),
  hint: vi.fn(),
}))

vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: state.exists,
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), () => ({
  createCheckpoint: vi.fn(),
  shouldRun: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/constants'), () => ({
  CHECKPOINT_CHAINS: { simple: () => ['finalized'] },
  CHECKPOINTS: { FINALIZED: 'finalized' },
  getBuildMode: () => 'prod',
  getPlatformBuildDir: () => '/example/build',
}))
vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  tarSupportsNoAbsoluteNames: state.tarSupports,
}))
vi.mock(import('local-build-infra/lib/release-checksums/core'), () => ({
  verifyReleaseChecksum: state.checksum,
}))
vi.mock(import('local-build-infra/lib/github-error-utils'), () => ({
  logTransientErrorHelp: state.hint,
}))
vi.mock(import('local-curl-builder/lib/ensure-curl'), () => ({
  ensureCurl: state.curl,
}))
vi.mock(import('@socketsecurity/lib-stable/env/ci'), () => ({
  getCI: () => state.ci,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: state.delete,
  safeMkdir: state.mkdir,
}))
vi.mock(import('@socketsecurity/lib-stable/releases/socket-btm'), () => ({
  downloadSocketBtmRelease: state.download,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: state.spawn,
}))
vi.mock(import('../lib/build-stubs-properties.mts'), () => ({
  getCurrentStubPlatformArch: async () => 'darwin-arm64',
  getMakefileName: () => 'Makefile.macos',
  getStubBinaryName: () => 'smol_stub',
  getStubOutDir: () => '/example/local/out',
  parsePlatformArch: () => ({ platform: 'darwin', arch: 'arm64' }),
  stubDir: '/example/source',
  stubExistsAt: state.stubExists,
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('BUILD_ALL_FROM_SOURCE', '')
  vi.stubEnv('BUILD_DEPS_FROM_SOURCE', '')
  vi.stubEnv('TARGET_ARCH', '')
  state.ci = false
  state.exists.mockReturnValue(true)
  state.stubExists.mockReturnValue(false)
  state.spawn.mockResolvedValue({ code: 0, stdout: 'smol_stub\r\n' })
  state.download.mockResolvedValue('/example/archive.tar.gz')
  state.checksum.mockResolvedValue({ valid: true, actual: 'example-checksum' })
  state.tarSupports.mockResolvedValue(true)
  state.curl.mockResolvedValue('/example/curl')
})

afterEach(() => vi.unstubAllEnvs())

test('builds the requested architecture with the selected build mode', async () => {
  vi.stubEnv('TARGET_ARCH', 'x64')
  await buildStubFromSource('darwin-x64')
  expect(state.spawn).toHaveBeenCalledWith(
    'make',
    ['-f', 'Makefile.macos', 'clean', 'all'],
    {
      cwd: '/example/source',
      env: expect.objectContaining({
        BUILD_MODE: 'prod',
        PLATFORM_ARCH: 'darwin-x64',
        TARGET_ARCH: 'x64',
      }),
      stdio: 'inherit',
    },
  )
})

test('rejects missing source before starting make', async () => {
  state.exists.mockReturnValue(false)
  await expect(buildStubFromSource('darwin-arm64')).rejects.toThrow()
  expect(state.spawn).not.toHaveBeenCalled()
})

test('rejects a failed make invocation', async () => {
  state.spawn.mockRejectedValue(new Error('Fixture make command failed'))
  await expect(buildStubFromSource('darwin-arm64')).rejects.toThrow()
})

test.each(['BUILD_ALL_FROM_SOURCE', 'BUILD_DEPS_FROM_SOURCE'])(
  'respects %s before downloading',
  async variable => {
    vi.stubEnv(variable, 'true')
    await expect(downloadPrebuiltStub()).rejects.toThrow()
    expect(state.download).not.toHaveBeenCalled()
  },
)

test.each([true, false])(
  'verifies the archive before extraction, tar safety flag=%s',
  async supported => {
    state.tarSupports.mockResolvedValue(supported)
    state.checksum.mockResolvedValue({
      valid: true,
      actual: supported ? 'example-checksum' : '',
    })
    const directory = await downloadPrebuiltStub()
    expect(directory).toEqual(
      expect.stringContaining(path.join('downloaded', 'stubs', 'darwin-arm64')),
    )
    expect(state.download).toHaveBeenCalledWith('stubs', {
      asset: 'smol-stub-darwin-arm64.tar.gz',
      downloadDir: directory,
    })
    expect(state.spawn).toHaveBeenNthCalledWith(
      1,
      'tar',
      ['-tzf', '/example/archive.tar.gz'],
      { stdio: 'pipe' },
    )
    expect(state.spawn).toHaveBeenNthCalledWith(
      2,
      'tar',
      [
        '-xzf',
        '/example/archive.tar.gz',
        '-C',
        directory,
        ...(supported ? ['--no-absolute-names'] : []),
      ],
      { stdio: 'inherit' },
    )
    expect(state.delete).toHaveBeenCalledWith('/example/archive.tar.gz')
  },
)

test('deletes a corrupt archive without extracting it', async () => {
  state.checksum.mockResolvedValue({
    valid: false,
    expected: 'expected-checksum',
    actual: 'corrupt-checksum',
  })
  await expect(downloadPrebuiltStub()).resolves.toBeUndefined()
  expect(state.delete).toHaveBeenCalledWith('/example/archive.tar.gz')
  expect(state.spawn).not.toHaveBeenCalled()
})

test.each(['../outside', '/absolute/path', 'folder/../../outside'])(
  'rejects unsafe archive entry %s',
  async entry => {
    state.spawn.mockResolvedValue({ code: 0, stdout: `smol_stub\n${entry}\n` })
    await expect(downloadPrebuiltStub()).resolves.toBeUndefined()
    expect(state.spawn).toHaveBeenCalledOnce()
  },
)

test('returns an unavailable download even if diagnostic help fails', async () => {
  state.download.mockRejectedValue(new Error('Fixture download failure'))
  state.hint.mockRejectedValue(new Error('Fixture diagnostic failure'))
  await expect(
    downloadPrebuiltStub({ platformArch: 'linux-x64' }),
  ).resolves.toBeUndefined()
  expect(state.spawn).not.toHaveBeenCalled()
})

test('does not extract an archive when its listing fails', async () => {
  state.spawn.mockRejectedValueOnce(new Error('Fixture archive listing failed'))
  await expect(downloadPrebuiltStub()).resolves.toBeUndefined()
  expect(state.spawn).toHaveBeenCalledOnce()
})

test('does not return a usable stub directory after extraction fails', async () => {
  state.spawn.mockResolvedValueOnce({ code: 0, stdout: 'smol_stub\n' })
  state.spawn.mockRejectedValueOnce(
    new Error('Fixture archive extraction failed'),
  )
  await expect(downloadPrebuiltStub()).resolves.toBeUndefined()
  expect(state.delete).not.toHaveBeenCalled()
})

test.each([true, false])('reuses an existing stub, local=%s', async local => {
  state.stubExists.mockReturnValueOnce(local).mockReturnValueOnce(true)
  const result = await ensureStubs()
  expect(result).toEqual(
    local
      ? '/example/local/out/smol_stub'
      : expect.stringContaining(
          path.join('downloaded', 'stubs', 'darwin-arm64', 'smol_stub'),
        ),
  )
  expect(state.spawn).not.toHaveBeenCalled()
  expect(state.download).not.toHaveBeenCalled()
})

test('force rebuild skips both existing stub locations', async () => {
  state.stubExists.mockReturnValue(true)
  await expect(ensureStubs({ force: true })).resolves.toBe(
    '/example/local/out/smol_stub',
  )
  expect(state.stubExists).not.toHaveBeenCalled()
  expect(state.curl).toHaveBeenCalledOnce()
  expect(state.spawn).toHaveBeenCalledOnce()
})

test('can build when optional curl setup fails', async () => {
  state.curl.mockRejectedValue(new Error('Fixture curl unavailable'))
  await expect(ensureStubs()).resolves.toBe('/example/local/out/smol_stub')
})

test('downloads when source is absent', async () => {
  state.exists.mockReturnValue(false)
  await expect(ensureStubs()).resolves.toEqual(
    expect.stringContaining(path.join('downloaded', 'stubs')),
  )
  expect(state.curl).not.toHaveBeenCalled()
})

test('fails when neither source nor a download is available', async () => {
  state.exists.mockReturnValue(false)
  state.download.mockRejectedValue(new Error('Fixture download unavailable'))
  await expect(ensureStubs()).rejects.toThrow()
})

test('fails closed in CI after a source build failure', async () => {
  state.ci = true
  const failure = new Error('Fixture make failure')
  state.spawn.mockRejectedValue(failure)
  await expect(ensureStubs()).rejects.toMatchObject({ cause: failure })
  expect(state.download).not.toHaveBeenCalled()
})

test.each([true, false])(
  'falls back after a local build failure, download available=%s',
  async available => {
    const failure = new Error('Fixture make failure')
    state.spawn.mockRejectedValueOnce(failure)
    if (!available) {
      state.download.mockRejectedValue(
        new Error('Fixture download unavailable'),
      )
    }
    const result = ensureStubs()
    if (available) {
      await expect(result).resolves.toEqual(
        expect.stringContaining(path.join('downloaded', 'stubs')),
      )
    } else {
      await expect(result).rejects.toMatchObject({ cause: failure })
    }
  },
)
