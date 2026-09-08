import process from 'node:process'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  appendReleaseConfigureFlags,
  configureReleaseArchitecture,
  getReleaseConfigureFlags,
  verifyReleaseDawnArtifact,
} from '../../scripts/binary-released/shared/release-configure.mts'

const io = vi.hoisted(() => ({
  exists: vi.fn(),
  paths: vi.fn(),
  platform: vi.fn(),
}))
vi.mock(import('node:fs'), async importOriginal => {
  const original = await importOriginal()
  return {
    ...original,
    existsSync: filename =>
      filename === '/example/dawn.a'
        ? io.exists(filename)
        : original.existsSync(filename),
  }
})
vi.mock(import('local-dawn-builder/scripts/paths'), async importOriginal => ({
  ...(await importOriginal()),
  getBuildPaths: io.paths,
}))
vi.mock(
  import('local-build-infra/lib/platform-mappings'),
  async importOriginal => ({
    ...(await importOriginal()),
    getCurrentPlatformArch: io.platform,
  }),
)

beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(true)
  io.paths.mockReturnValue({ outputLibFile: '/example/dawn.a' })
  io.platform.mockResolvedValue('linux-x64')
})

test('appends unique detector flags in order without duplicating standard flags', () => {
  const flags = ['--without-inspector']
  appendReleaseConfigureFlags(flags, [
    '--without-inspector',
    '--without-sqlite',
    '--without-sqlite',
    '--without-smol-ai',
  ])
  expect(flags).toEqual([
    '--without-inspector',
    '--without-sqlite',
    '--without-smol-ai',
  ])
})

test('refuses unapproved cross compilation and allows explicit cross compilation', () => {
  const arch = process.arch === 'arm64' ? 'x64' : 'arm64'
  const flags: string[] = []
  expect(() =>
    configureReleaseArchitecture(flags, {
      allowCross: false,
      arch,
      platform: 'linux',
    }),
  ).toThrow()
  expect(flags).toEqual([])
  expect(
    configureReleaseArchitecture(flags, {
      allowCross: true,
      arch,
      platform: 'linux',
    }),
  ).toBe(true)
  expect(flags).toEqual([`--dest-cpu=${arch}`])
})

test('supports Windows cross compilation without an explicit cross flag', () => {
  const arch = process.arch === 'arm64' ? 'x64' : 'arm64'
  const flags: string[] = []
  expect(
    configureReleaseArchitecture(flags, {
      allowCross: false,
      arch,
      platform: 'win32',
    }),
  ).toBe(true)
  expect(flags).toEqual([`--dest-cpu=${arch}`])
})

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`sets production portability flags for ${platform}`, async () => {
    const { configureFlags } = await getReleaseConfigureFlags({
      allowCross: true,
      arch: 'x64',
      buildMode: 'prod',
      isProdBuild: true,
      libc: 'musl',
      platform,
      withDawn: false,
      withLief: false,
    })
    expect(configureFlags).toContain('--without-lief')
    expect(configureFlags).toContain('--without-inspector')
    expect(configureFlags).toContain('--fully-static')
    expect(configureFlags.includes('--enable-lto')).toBe(platform !== 'win32')
    expect(configureFlags.includes('--openssl-no-asm')).toBe(
      platform === 'linux',
    )
  })
}

test('retains development inspector and LIEF without probing unrequested Dawn', async () => {
  const { configureFlags, isCrossCompiling } = await getReleaseConfigureFlags({
    allowCross: false,
    arch: process.arch,
    buildMode: 'dev',
    isProdBuild: false,
    libc: 'glibc',
    platform: process.platform,
    withDawn: false,
    withLief: true,
  })
  expect(configureFlags).not.toContain('--without-lief')
  expect(configureFlags).not.toContain('--without-inspector')
  expect(configureFlags).not.toContain('--enable-lto')
  expect(isCrossCompiling).toBe(false)
  expect(io.paths).not.toHaveBeenCalled()
})

test('requires the canonical Dawn artifact only when requested', async () => {
  await expect(
    verifyReleaseDawnArtifact({ withDawn: true, buildMode: 'prod' }),
  ).resolves.toBeUndefined()
  expect(io.paths).toHaveBeenCalledWith('prod', 'linux-x64')
  expect(io.exists).toHaveBeenCalledWith('/example/dawn.a')
  io.exists.mockReturnValue(false)
  await expect(
    verifyReleaseDawnArtifact({ withDawn: true, buildMode: 'dev' }),
  ).rejects.toThrow()
})
