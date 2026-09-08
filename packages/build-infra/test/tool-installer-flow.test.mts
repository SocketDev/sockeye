import { beforeEach, describe, expect, test, vi } from 'vitest'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { getToolConfig } from '../lib/pinned-versions.mts'
import { detectPackageManagers } from '../lib/tool-installer-config.mts'
import { installTool, verifyToolWorks } from '../lib/tool-installer-impl.mts'
import { ensureToolInstalled } from '../lib/tool-installer.mts'

vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: vi.fn(),
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
  getInstallInstructions: vi.fn(),
  getPackageManagerInstructions: vi.fn(),
  getPreferredPackageManager: vi.fn(),
}))
vi.mock(import('../lib/tool-installer-impl.mts'), () => ({
  checkElevatedPrivileges: vi.fn(),
  installPackageManager: vi.fn(),
  installTool: vi.fn(),
  resolvePinnedArtifact: vi.fn(),
  verifyToolWorks: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(detectPackageManagers).mockReturnValue(['brew'])
  vi.mocked(verifyToolWorks).mockResolvedValue(true)
  vi.mocked(installTool).mockResolvedValue(true)
})

describe('tool installation phases', () => {
  test('accepts a working binary without installing', async () => {
    vi.mocked(whichSync).mockReturnValue('/example/tool')
    expect(await ensureToolInstalled('example-tool')).toMatchObject({
      available: true,
      installed: false,
    })
    expect(vi.mocked(installTool).mock.calls).toHaveLength(0)
  })

  test('reports a broken existing tool without installing it again', async () => {
    vi.mocked(whichSync).mockReturnValue('/example/tool')
    vi.mocked(verifyToolWorks).mockResolvedValue(false)
    expect(await ensureToolInstalled('example-tool')).toMatchObject({
      available: false,
      installed: false,
    })
    expect(vi.mocked(installTool).mock.calls).toHaveLength(0)
  })

  test('stops when a required dependency cannot be installed', async () => {
    vi.mocked(getToolConfig).mockReturnValueOnce({
      dependencies: ['example-dependency'],
    } as ReturnType<typeof getToolConfig>)
    vi.mocked(installTool).mockResolvedValue(false)
    expect(await ensureToolInstalled('example-tool')).toMatchObject({
      available: false,
      installed: false,
    })
    expect(vi.mocked(installTool).mock.calls.map(call => call[0])).toEqual([
      'example-dependency',
    ])
  })

  test('does not install a missing binary when disabled', async () => {
    expect(
      await ensureToolInstalled('example-tool', { autoInstall: false }),
    ).toMatchObject({ available: false, installed: false })
    expect(vi.mocked(detectPackageManagers).mock.calls).toHaveLength(0)
  })

  test('fails without an available package manager', async () => {
    vi.mocked(detectPackageManagers).mockReturnValue([])
    expect(await ensureToolInstalled('example-tool')).toMatchObject({
      available: false,
      installed: false,
    })
    expect(vi.mocked(installTool).mock.calls).toHaveLength(0)
  })

  test('verifies the installed tool and forwards approval options', async () => {
    expect(
      await ensureToolInstalled('example-tool', { autoYes: true }),
    ).toMatchObject({
      available: true,
      installed: true,
      packageManager: 'brew',
    })
    expect(vi.mocked(installTool).mock.calls).toEqual([
      ['example-tool', 'brew', { autoYes: true }],
    ])
    expect(vi.mocked(verifyToolWorks).mock.calls).toEqual([
      ['example-tool', ['--version']],
    ])
  })

  test('reports a failed verification after installation', async () => {
    vi.mocked(verifyToolWorks).mockResolvedValue(false)
    expect(await ensureToolInstalled('example-tool')).toMatchObject({
      available: false,
      installed: true,
      packageManager: 'brew',
    })
  })

  test('repairs dependencies before retrying an existing binary', async () => {
    vi.mocked(whichSync).mockReturnValue('/example/tool')
    vi.mocked(getToolConfig).mockReturnValueOnce({
      dependencies: ['example-dependency'],
    } as ReturnType<typeof getToolConfig>)
    vi.mocked(verifyToolWorks)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    expect(await ensureToolInstalled('example-tool')).toMatchObject({
      available: true,
      installed: false,
    })
    expect(vi.mocked(verifyToolWorks).mock.calls.map(call => call[0])).toEqual([
      'example-tool',
      'example-dependency',
      'example-tool',
    ])
    expect(vi.mocked(installTool).mock.calls).toHaveLength(0)
  })
})
