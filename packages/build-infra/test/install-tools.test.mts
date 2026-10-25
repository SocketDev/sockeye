import { beforeEach, describe, expect, test, vi } from 'vitest'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getToolVersion } from '../lib/pinned-versions.mts'
import { createToolInstallCommand, installTool } from '../lib/install-tools.mts'

vi.mock(import('node:os'), () => ({ default: { platform: () => 'linux' } }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolVersion: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    pid: 0,
    stdout: '',
    stderr: '',
  })
  vi.mocked(getToolVersion).mockReturnValue('12.3.4')
})

describe('system tool installation', () => {
  test('skips an already installed tool before resolving its pin', async () => {
    expect(await installTool('example-tool')).toBe(true)
    expect(vi.mocked(spawn).mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['which', ['example-tool']],
    ])
    expect(vi.mocked(getToolVersion).mock.calls).toHaveLength(0)
  })

  test('installs the resolved pin with the first detected package manager', async () => {
    expect(await installTool('example-tool', { force: true })).toBe(true)
    const invocation = vi.mocked(spawn).mock.calls.at(-1)!
    expect(invocation.slice(0, 2)).toEqual([
      'sudo',
      ['apt-get', 'install', '-y', 'example-tool=12.3.4-*'],
    ])
    expect(invocation[2]).toMatchObject({
      env: { HOMEBREW_NO_ANALYTICS: '1' },
      stdio: 'inherit',
    })
  })

  test('honors explicitly disabled version pinning', async () => {
    expect(
      await installTool('example-tool', { force: true, skipVersionPin: true }),
    ).toBe(true)
    expect(vi.mocked(spawn).mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'sudo',
      ['apt-get', 'install', '-y', 'example-tool'],
    ])
    expect(vi.mocked(getToolVersion).mock.calls).toHaveLength(0)
  })

  test('preserves the installation failure cause', async () => {
    const failure = new Error('fixture install failure')
    vi.mocked(spawn).mockImplementation(async command => {
      if (command === 'sudo') {
        throw failure
      }
      return { code: 0, pid: 0, stdout: '', stderr: '' }
    })
    await expect(
      installTool('example-tool', { force: true }),
    ).rejects.toMatchObject({ cause: failure })
  })
})

describe('system package-manager command construction', () => {
  test.each([
    ['brew', 'brew', ['install', 'example-tool']],
    ['yum', 'sudo', ['yum', 'install', '-y', 'example-tool=12.3.4-*']],
    ['dnf', 'sudo', ['dnf', 'install', '-y', 'example-tool=12.3.4-*']],
    ['apk', 'sudo', ['apk', 'add', 'example-tool=12.3.4-*']],
    ['choco', 'choco', ['install', '-y', 'example-tool', '--version=12.3.4']],
    ['scoop', 'scoop', ['install', 'example-tool']],
  ])('preserves %s installation arguments', (pkgMgr, command, args) => {
    expect(
      createToolInstallCommand({
        toolName: 'example-tool',
        pkgMgr,
        version: '12.3.4',
      }),
    ).toEqual({ command, args })
  })
})
