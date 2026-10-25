import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { which, whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getPlatform } from '../lib/build-env.mts'
import { getToolConfig, getToolVersion } from '../lib/pinned-versions.mts'
import {
  checkElevatedPrivileges,
  installPackageManager,
  installTool,
  linkInstalledTool,
  resolvePinnedArtifact,
  verifyToolWorks,
} from '../lib/tool-installer-impl.mts'
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  readFileSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  which: vi.fn(),
  whichSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/build-env.mts'), () => ({ getPlatform: vi.fn() }))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolConfig: vi.fn(),
  getToolVersion: vi.fn(),
}))
vi.mock(import('../lib/tool-installer-config.mts'), () => ({
  KEG_ONLY_FORMULAS: new Set(['example-keg']),
  PACKAGE_MANAGER_CONFIGS: {
    linux: {
      example: {
        name: 'Example Manager',
        binary: 'example-manager',
        installScript: 'example-offline-installer',
      },
      manual: { name: 'Manual Manager', binary: 'example-manual' },
    },
  },
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getPlatform).mockReturnValue('linux')
  vi.mocked(getToolConfig).mockReturnValue({ version: '12.3.4' })
  vi.mocked(getToolVersion).mockReturnValue('12.3.4')
  vi.mocked(which).mockResolvedValue('/example/command')
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: '',
    stderr: '',
    pid: 0,
  })
  vi.spyOn(process, 'getuid').mockReturnValue(1000)
})
afterEach(() => vi.restoreAllMocks())
test('recognizes root without invoking sudo', async () => {
  vi.spyOn(process, 'getuid').mockReturnValue(0)
  expect(await checkElevatedPrivileges()).toBe(true)
  expect(spawn).not.toHaveBeenCalled()
})
test.each(['linux', 'win32'])(
  'checks elevated privilege without prompting on %s',
  async platform => {
    vi.mocked(getPlatform).mockReturnValue(platform)
    expect(await checkElevatedPrivileges()).toBe(true)
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(
      platform === 'win32' ? ['session'] : ['-n', 'true'],
    )
    vi.mocked(spawn).mockRejectedValue(new Error('fixture privilege denied'))
    expect(await checkElevatedPrivileges()).toBe(false)
    vi.mocked(which).mockResolvedValue(undefined)
    expect(await checkElevatedPrivileges()).toBe(false)
  },
)
test('rejects unknown platforms, managers and manual-only bootstrap paths', async () => {
  vi.mocked(getPlatform).mockReturnValue('unknown')
  expect(await installPackageManager('example')).toBe(false)
  vi.mocked(getPlatform).mockReturnValue('linux')
  expect(await installPackageManager('unknown')).toBe(false)
  expect(await installPackageManager('manual', { autoYes: true })).toBe(false)
  expect(await installPackageManager('example')).toBe(false)
  expect(spawn).not.toHaveBeenCalled()
})
test('returns an existing manager without executing its installer', async () => {
  vi.mocked(whichSync).mockReturnValue('/example/manager')
  expect(await installPackageManager('example')).toBe(true)
  expect(spawn).not.toHaveBeenCalled()
})
test.each([true, false])(
  'verifies package manager after bootstrap, present=%s',
  async present => {
    vi.mocked(whichSync)
      .mockReturnValueOnce(undefined)
      .mockReturnValue(present ? '/example/manager' : undefined)
    expect(await installPackageManager('example', { autoYes: true })).toBe(
      present,
    )
    expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([
      '/example/command',
      ['-c', 'example-offline-installer'],
    ])
  },
)
test('refuses missing bootstrap shell and catches installer rejection', async () => {
  vi.mocked(which).mockResolvedValue(undefined)
  expect(await installPackageManager('example', { autoYes: true })).toBe(false)
  expect(spawn).not.toHaveBeenCalled()
  vi.mocked(which).mockResolvedValue('/example/sh')
  vi.mocked(spawn).mockRejectedValue(new Error('fixture bootstrap failure'))
  expect(await installPackageManager('example', { autoYes: true })).toBe(false)
})
test('refuses unsupported tool managers and unverified installed binaries', async () => {
  expect(await installTool('example-tool', 'unknown')).toBe(false)
  expect(spawn).not.toHaveBeenCalled()
  expect(await installTool('example-tool', 'apt', { version: '13.0.0' })).toBe(
    false,
  )
  expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain('example-tool=13.0.0*')
  expect(getToolVersion).toHaveBeenCalledTimes(1)
})
test('handles install or link process failures without claiming success', async () => {
  vi.mocked(spawn).mockRejectedValue(
    Object.assign(new Error('fixture process failure'), { code: 1 }),
  )
  expect(await installTool('example-tool', 'apt')).toBe(false)
  await expect(
    linkInstalledTool({
      packageManager: 'brew',
      packageName: 'example-keg',
      commandPath: '/example/brew',
    }),
  ).rejects.toThrow()
})
test('keeps telemetry disabled when installing and linking keg-only formulas', async () => {
  vi.mocked(whichSync).mockReturnValue('/example/tool')
  expect(await installTool('example-keg', 'brew')).toBe(true)
  for (const call of vi.mocked(spawn).mock.calls) {
    expect(call[2]).toMatchObject({ env: { HOMEBREW_NO_ANALYTICS: '1' } })
  }
})
test('verifies requested tool arguments and handles missing or rejected commands', async () => {
  expect(await verifyToolWorks('example-tool')).toBe(false)
  vi.mocked(whichSync).mockReturnValue('/example/tool')
  expect(await verifyToolWorks('example-tool', ['version'])).toBe(true)
  expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([
    '/example/tool',
    ['version'],
  ])
  vi.mocked(spawn).mockRejectedValue(new Error('fixture tool failure'))
  expect(await verifyToolWorks('example-tool')).toBe(false)
})
test.each(['zip', 'tar.xz'])(
  'resolves pinned %s artifact for the running platform',
  format => {
    const arch =
      process.arch === 'arm64'
        ? 'aarch64'
        : process.arch === 'x64'
          ? 'x86_64'
          : process.arch
    const os =
      process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'win32'
          ? 'windows'
          : process.platform
    const artifact = {
      url: `https://example.invalid/tool.${format}`,
      sha256: 'a'.repeat(64),
      extractDir: 'example-tool',
    }
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ artifacts: { [`${arch}-${os}`]: artifact } }),
    )
    expect(resolvePinnedArtifact('example-tool', '12.3.4')).toEqual({
      ...artifact,
      binary:
        process.platform === 'win32' ? 'example-tool.exe' : 'example-tool',
      archiveFormat: format,
    })
  },
)
test('rejects absent, malformed and unmatched checksum manifests', () => {
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error('fixture missing manifest')
  })
  expect(resolvePinnedArtifact('example-tool', '12.3.4')).toBeUndefined()
  vi.mocked(readFileSync).mockReturnValue('invalid-json')
  expect(resolvePinnedArtifact('example-tool', '12.3.4')).toBeUndefined()
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ artifacts: {} }))
  expect(resolvePinnedArtifact('example-tool', '12.3.4')).toBeUndefined()
})
