import { beforeEach, describe, expect, test, vi } from 'vitest'
import { which, whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getToolConfig, getToolVersion } from '../lib/pinned-versions.mts'
import { installTool } from '../lib/tool-installer-impl.mts'

vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  which: vi.fn(),
  whichSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/build-env.mts'), () => ({ getPlatform: () => 'linux' }))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolConfig: vi.fn(),
  getToolVersion: vi.fn(),
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: vi.fn() }))
vi.mock(import('../lib/tool-installer-config.mts'), () => ({
  KEG_ONLY_FORMULAS: new Set(['example-keg']),
  PACKAGE_MANAGER_CONFIGS: {},
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getToolConfig).mockReturnValue({ version: '12.3.4' })
  vi.mocked(getToolVersion).mockReturnValue('12.3.4')
  vi.mocked(which).mockResolvedValue('/example/manager')
  vi.mocked(whichSync).mockReturnValue('/example/tool')
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    pid: 0,
    stdout: '',
    stderr: '',
  })
})

describe('package manager installation execution', () => {
  test('uses a pinned apt package and verifies its installed binary', async () => {
    expect(await installTool('example-tool', 'apt')).toBe(true)
    expect(vi.mocked(which).mock.calls[0]?.[0]).toBe('sudo')
    expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([
      '/example/manager',
      ['apt-get', 'install', '-y', 'example-tool=12.3.4*'],
    ])
    expect(vi.mocked(whichSync).mock.calls[0]?.[0]).toBe('example-tool')
  })

  test.each([
    ['apk', ['apk', 'add', '--no-cache', 'example-tool=12.3.4']],
    ['yum', ['yum', 'install', '-y', 'example-tool-12.3.4']],
    ['dnf', ['dnf', 'install', '-y', 'example-tool-12.3.4']],
    ['choco', ['install', 'example-tool', '--version', '12.3.4', '-y']],
    ['scoop', ['install', 'example-tool@12.3.4']],
  ])('preserves %s version syntax', async (manager, args) => {
    expect(await installTool('example-tool', manager, { autoYes: true })).toBe(
      true,
    )
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(args)
  })

  test('rejects an unknown tool before spawning', async () => {
    vi.mocked(getToolConfig).mockReturnValue(undefined)
    expect(await installTool('example-tool', 'apt')).toBe(false)
    expect(vi.mocked(spawn).mock.calls).toHaveLength(0)
  })

  test('rejects a failed package-manager exit before verifying', async () => {
    vi.mocked(spawn).mockResolvedValue({
      code: 1,
      pid: 0,
      stdout: '',
      stderr: '',
    })
    expect(await installTool('example-tool', 'apt')).toBe(false)
    expect(vi.mocked(whichSync).mock.calls).toHaveLength(0)
  })

  test('force-links a keg-only formula after successful installation', async () => {
    expect(await installTool('example-keg', 'brew')).toBe(true)
    expect(vi.mocked(spawn).mock.calls.map(call => call[1])).toEqual([
      ['install', 'example-keg'],
      ['link', '--overwrite', '--force', 'example-keg'],
    ])
  })

  test('rejects a missing command without spawning', async () => {
    vi.mocked(which).mockResolvedValue(undefined)
    expect(await installTool('example-tool', 'apt')).toBe(false)
    expect(vi.mocked(spawn).mock.calls).toHaveLength(0)
  })
})
