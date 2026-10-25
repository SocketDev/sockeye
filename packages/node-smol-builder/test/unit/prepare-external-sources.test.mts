import { beforeEach, expect, test, vi } from 'vitest'
import path from 'node:path'
import process from 'node:process'
import { promises as fs } from 'node:fs'
import { isDirSync } from '@socketsecurity/lib-stable/fs/inspect'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { applyPatch } from 'local-build-infra/lib/patch-validator'
import { generateVendoredGypi } from '../../scripts/binary-released/shared/prepare-gypi.mts'
import { copySmolAiArtifacts } from '../../scripts/binary-released/shared/prepare-smol-ai.mts'
import {
  applyVendorPatches,
  copyBoringsslArtifacts,
  copyGlibcShimsInfra,
  prepareExternalSources,
  syncVendoredPackages,
  VENDOR_PATCH_BUNDLES,
} from '../../scripts/binary-released/shared/prepare-external-sources.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  readdir: vi.fn(),
  boringssl: vi.fn(),
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  io.exists.mockImplementation(actual.existsSync)
  return {
    ...actual,
    existsSync: io.exists,
    promises: { ...actual.promises, readdir: io.readdir, cp: vi.fn() },
  }
})
vi.mock(import('@socketsecurity/lib-stable/fs/inspect'), () => ({
  isDirSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(),
  safeMkdir: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/patch-validator'), () => ({
  applyPatch: vi.fn(),
}))
vi.mock(
  import('../../scripts/binary-released/shared/prepare-gypi.mts'),
  () => ({ generateVendoredGypi: vi.fn() }),
)
vi.mock(
  import('../../scripts/binary-released/shared/prepare-smol-ai.mts'),
  () => ({ copySmolAiArtifacts: vi.fn() }),
)
vi.mock(import('../../scripts/paths.mts'), async original => {
  const { fileURLToPath } = await import('node:url')
  return {
    ...(await original()),
    BORINGSSL_BUILDER_DIR: fileURLToPath(
      new URL('../fixtures/boringssl', import.meta.url),
    ),
    GLIBC_SHIMS_INFRA_DIR: '/example/glibc',
    PACKAGE_ROOT: '/example/package',
  }
})
vi.mock(import('../../scripts/binary-released/shared/paths.mts'), () => ({
  ADDITIONS_SOURCE_PATCHED_DIR: '/example/additions',
  LSQUIC_PATCHED_DIR: '/example/additions/deps/lsquic',
}))
vi.mock(
  import('../../scripts/binary-released/shared/prepare-vendored-sources.mts'),
  () => ({
    EXTERNAL_SOURCES: [
      {
        from: '/example/upstream/lsquic',
        to: '/example/additions/deps/lsquic',
      },
      { from: '/example/upstream/other', to: '/example/additions/deps/other' },
    ],
  }),
)
vi.mock(import('../fixtures/boringssl/lib/ensure-boringssl.mts'), () => ({
  ensureBoringssl: io.boringssl,
  getCurrentBoringsslPlatformArch: () => 'darwin-arm64',
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.exists.mockReturnValue(true)
  io.readdir.mockResolvedValue([
    '002-second.patch',
    'README.md',
    '001-first.patch',
  ])
  io.boringssl.mockResolvedValue('/example/sysroot')
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: '',
    stderr: '',
    pid: 0,
  })
})
test('skips missing and empty vendor patch bundles', async () => {
  io.exists.mockReturnValue(false)
  await applyVendorPatches()
  expect(io.readdir).not.toHaveBeenCalled()
  io.exists.mockReturnValue(true)
  io.readdir.mockResolvedValue(['README.md'])
  await applyVendorPatches()
  expect(applyPatch).not.toHaveBeenCalled()
})
test('requires the vendor target before applying patches', async () => {
  io.exists.mockImplementation(
    file => file !== VENDOR_PATCH_BUNDLES[0]!.targetDir,
  )
  await expect(applyVendorPatches()).rejects.toThrow()
  expect(applyPatch).not.toHaveBeenCalled()
})
test('applies sorted vendor patches and preserves failure cause', async () => {
  await applyVendorPatches()
  expect(vi.mocked(applyPatch).mock.calls).toEqual(
    ['001-first.patch', '002-second.patch'].map(name => [
      path.join(VENDOR_PATCH_BUNDLES[0]!.patchesDir, name),
      VENDOR_PATCH_BUNDLES[0]!.targetDir,
    ]),
  )
  const failure = new Error('fixture rejected patch')
  vi.mocked(applyPatch).mockRejectedValue(failure)
  await expect(applyVendorPatches()).rejects.toMatchObject({ cause: failure })
})
test('stages glibc gyp configuration beside its source tree', async () => {
  await copyGlibcShimsInfra()
  expect(safeMkdir).toHaveBeenCalledExactlyOnceWith(
    '/example/additions/deps/glibc-shims-infra',
  )
  expect(vi.mocked(fs.cp).mock.calls).toEqual([
    [
      '/example/glibc/gyp/glibc-shims-infra.gypi',
      '/example/additions/deps/glibc-shims-infra/glibc-shims-infra.gypi',
      { force: true },
    ],
    [
      '/example/glibc/src',
      '/example/additions/deps/glibc-shims-infra/src',
      { recursive: true, force: true },
    ],
  ])
})
test.each(['lib', 'include'])(
  'rejects BoringSSL sysroot with missing %s before copying',
  async missing => {
    io.exists.mockImplementation(file => file !== `/example/sysroot/${missing}`)
    await expect(copyBoringsslArtifacts()).rejects.toThrow()
    expect(fs.cp).not.toHaveBeenCalled()
  },
)
test('stages only validated BoringSSL libraries and headers', async () => {
  await copyBoringsslArtifacts()
  expect(io.boringssl).toHaveBeenCalledExactlyOnceWith('darwin-arm64')
  expect(vi.mocked(fs.cp).mock.calls).toEqual(
    ['lib', 'include'].map(name => [
      `/example/sysroot/${name}`,
      `/example/additions/deps/boringssl/${name}`,
      { recursive: true, force: true },
    ]),
  )
})
test('refuses missing external source without clearing existing targets', async () => {
  io.exists.mockImplementation(file => file !== '/example/upstream/lsquic')
  await expect(
    prepareExternalSources({ buildMode: 'prod', platformArch: 'darwin-arm64' }),
  ).rejects.toThrow()
  expect(safeDelete).not.toHaveBeenCalled()
  expect(fs.cp).not.toHaveBeenCalled()
})
test('refreshes patched vendors, preserves unpatched targets and excludes metadata directories', async () => {
  await prepareExternalSources({
    buildMode: 'prod',
    platformArch: 'darwin-arm64',
  })
  expect(safeDelete).toHaveBeenCalledExactlyOnceWith(
    '/example/additions/deps/lsquic',
  )
  const options = vi.mocked(fs.cp).mock.calls[0]?.[2]
  expect(options).toMatchObject({ recursive: true, force: true })
  const filter = options?.filter
  expect(filter).toBeTypeOf('function')
  vi.mocked(isDirSync).mockReturnValue(true)
  expect(await filter?.('/example/.git', '/example/destination')).toBe(false)
  expect(await filter?.('/example/source', '/example/destination')).toBe(true)
  vi.mocked(isDirSync).mockReturnValue(false)
  expect(await filter?.('/example/.gitignore', '/example/destination')).toBe(
    true,
  )
  expect(generateVendoredGypi).toHaveBeenCalledTimes(1)
  expect(copySmolAiArtifacts).toHaveBeenCalledExactlyOnceWith(
    'prod',
    'darwin-arm64',
  )
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    ['/example/package/scripts/vendor-fast-webstreams/sync.mts'],
    { cwd: '/example/package', stdio: 'inherit' },
  )
  expect(vi.mocked(fs.cp).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(applyPatch).mock.invocationCallOrder[0]!,
  )
})
test('requires vendor sync script and propagates failed subprocess cause', async () => {
  io.exists.mockReturnValue(false)
  await expect(syncVendoredPackages()).rejects.toThrow()
  expect(spawn).not.toHaveBeenCalled()
  io.exists.mockReturnValue(true)
  const failure = Object.assign(new Error('fixture vendor sync failure'), {
    code: 1,
  })
  vi.mocked(spawn).mockRejectedValue(failure)
  await expect(syncVendoredPackages()).rejects.toMatchObject({ cause: failure })
})
