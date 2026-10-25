import { beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getToolConfig } from '../lib/pinned-versions.mts'
import {
  downloadAndCache,
  getCachedToolBinary,
} from '../lib/tool-downloader.mts'
import {
  detectPackageManagers,
  getPreferredPackageManager,
} from '../lib/tool-installer-config.mts'
import {
  installPackageManager,
  installTool,
  resolvePinnedArtifact,
  verifyToolWorks,
} from '../lib/tool-installer-impl.mts'
import {
  ensureAllToolsInstalled,
  ensurePackageManagerAvailable,
  ensurePinnedTool,
  ensureToolInstalled,
} from '../lib/tool-installer.mts'
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolConfig: vi.fn(),
}))
vi.mock(import('../lib/tool-downloader.mts'), () => ({
  downloadAndCache: vi.fn(),
  getCachedToolBinary: vi.fn(),
}))
vi.mock(import('../lib/tool-installer-config.mts'), () => ({
  detectPackageManagers: vi.fn(),
  getPreferredPackageManager: vi.fn(),
  getInstallInstructions: vi.fn(),
  getPackageManagerInstructions: vi.fn(),
}))
vi.mock(import('../lib/tool-installer-impl.mts'), () => ({
  installPackageManager: vi.fn(),
  installTool: vi.fn(),
  resolvePinnedArtifact: vi.fn(),
  verifyToolWorks: vi.fn(),
  checkElevatedPrivileges: vi.fn(),
}))
const artifact = {
  archiveFormat: 'tar.xz',
  binary: 'example-tool',
  extractDir: 'example-tool',
  sha256: 'a'.repeat(64),
  url: 'https://example.invalid/tool.tar.xz',
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(detectPackageManagers).mockReturnValue(['brew'])
  vi.mocked(getPreferredPackageManager).mockReturnValue('brew')
  vi.mocked(installPackageManager).mockResolvedValue(true)
  vi.mocked(installTool).mockResolvedValue(true)
  vi.mocked(verifyToolWorks).mockResolvedValue(true)
  vi.mocked(resolvePinnedArtifact).mockReturnValue(artifact)
  vi.mocked(downloadAndCache).mockResolvedValue('/example/cache/tool')
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: '12.3.4\n',
    stderr: '',
    pid: 0,
  })
})
test('reuses detected package manager without an install', async () => {
  expect(await ensurePackageManagerAvailable()).toEqual({
    available: true,
    installed: false,
    manager: 'brew',
  })
  expect(installPackageManager).not.toHaveBeenCalled()
})
test('does not bootstrap a package manager without an install policy or supported preference', async () => {
  vi.mocked(detectPackageManagers).mockReturnValue([])
  expect(await ensurePackageManagerAvailable()).toEqual({
    available: false,
    installed: false,
    manager: undefined,
  })
  vi.mocked(getPreferredPackageManager).mockReturnValue(undefined)
  expect(await ensurePackageManagerAvailable({ autoInstall: true })).toEqual({
    available: false,
    installed: false,
    manager: undefined,
  })
  expect(installPackageManager).not.toHaveBeenCalled()
})
test.each([true, false])(
  'reports package-manager installation success=%s',
  async installed => {
    vi.mocked(detectPackageManagers).mockReturnValue([])
    vi.mocked(installPackageManager).mockResolvedValue(installed)
    expect(
      await ensurePackageManagerAvailable({ autoInstall: true, autoYes: true }),
    ).toEqual({
      available: installed,
      installed,
      manager: installed ? 'brew' : undefined,
    })
    expect(installPackageManager).toHaveBeenCalledExactlyOnceWith('brew', {
      autoYes: true,
    })
  },
)
test('refuses unversioned pinned tools without external work', async () => {
  expect(await ensurePinnedTool('example-tool', {}, true)).toMatchObject({
    available: false,
    installed: false,
  })
  expect(whichSync).not.toHaveBeenCalled()
  expect(downloadAndCache).not.toHaveBeenCalled()
})
test('accepts only the exact system version', async () => {
  vi.mocked(whichSync).mockReturnValue('/example/system/tool')
  expect(
    await ensurePinnedTool('example-tool', { version: '12.3.4' }, false),
  ).toEqual({ available: true, installed: false, path: '/example/system/tool' })
  expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([
    '/example/system/tool',
    ['version'],
  ])
  expect(downloadAndCache).not.toHaveBeenCalled()
})
test.each(['12.3.3', '', 'failure'])(
  'rejects an unsuitable system version %s without auto-install',
  async version => {
    vi.mocked(whichSync).mockReturnValue('/example/system/tool')
    if (version === 'failure') {
      vi.mocked(spawn).mockRejectedValue(new Error('fixture version failure'))
    } else {
      vi.mocked(spawn).mockResolvedValue({
        code: 0,
        stdout: version,
        stderr: '',
        pid: 0,
      })
    }
    expect(
      await ensurePinnedTool('example-tool', { version: '12.3.4' }, false),
    ).toMatchObject({ available: false, installed: false })
    expect(resolvePinnedArtifact).not.toHaveBeenCalled()
  },
)
test('rejects platforms with no pinned checksum', async () => {
  vi.mocked(resolvePinnedArtifact).mockReturnValue(undefined)
  expect(
    await ensurePinnedTool('example-tool', { version: '12.3.4' }, true),
  ).toMatchObject({ available: false, installed: false })
  expect(downloadAndCache).not.toHaveBeenCalled()
})
test.each([true, false])(
  'uses checksum-validated cache or downloads, cached=%s',
  async cached => {
    vi.mocked(getCachedToolBinary).mockReturnValue(
      cached ? '/example/cached/tool' : undefined,
    )
    expect(
      await ensurePinnedTool('example-tool', { version: '12.3.4' }, true),
    ).toEqual({
      available: true,
      installed: !cached,
      path: cached ? '/example/cached/tool' : '/example/cache/tool',
    })
    expect(getCachedToolBinary).toHaveBeenCalledExactlyOnceWith(
      'example-tool',
      '12.3.4',
      process.platform,
      process.arch,
      artifact.binary,
      artifact.sha256,
    )
    if (cached) {
      expect(downloadAndCache).not.toHaveBeenCalled()
    } else {
      expect(downloadAndCache).toHaveBeenCalledExactlyOnceWith(
        'example-tool',
        artifact,
        '12.3.4',
        process.platform,
        process.arch,
      )
    }
  },
)
test('reports checksum/download failure and routes configured tools to the pinned flow', async () => {
  vi.mocked(getToolConfig).mockReturnValue({ version: '12.3.4' })
  vi.mocked(downloadAndCache).mockRejectedValue(
    new Error('fixture integrity failure'),
  )
  expect(await ensureToolInstalled('example-tool')).toMatchObject({
    available: false,
    installed: false,
  })
  expect(installTool).not.toHaveBeenCalled()
})
test.each(['present', 'installed', 'mixed'])(
  'summarizes sequential tool checks for %s tools',
  async mode => {
    vi.mocked(resolvePinnedArtifact).mockReturnValue(undefined)
    if (mode === 'present') {
      vi.mocked(whichSync).mockReturnValue('/example/tool')
    }
    if (mode === 'mixed') {
      vi.mocked(installTool)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
    }
    expect(
      await ensureAllToolsInstalled(['example-first', 'example-second'], {
        autoYes: true,
      }),
    ).toEqual({
      allAvailable: mode !== 'mixed',
      installed:
        mode === 'present'
          ? []
          : mode === 'mixed'
            ? ['example-first']
            : ['example-first', 'example-second'],
      missing: mode === 'mixed' ? ['example-second'] : [],
    })
  },
)
