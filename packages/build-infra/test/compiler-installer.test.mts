import { beforeEach, describe, expect, test, vi } from 'vitest'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getPlatform } from '../lib/build-env.mts'
import { detectPackageManagers } from '../lib/tool-installer.mts'
import { ensureGccVersion } from '../lib/compiler-installer.mts'

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/build-env.mts'), () => ({ getPlatform: vi.fn() }))
vi.mock(import('../lib/tool-installer.mts'), () => ({
  detectPackageManagers: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: 'gcc 11.2.0',
    stderr: '',
    pid: 0,
  })
  vi.mocked(getPlatform).mockReturnValue('linux')
  vi.mocked(detectPackageManagers).mockReturnValue(['apt'])
})

describe('GCC installation eligibility', () => {
  test('accepts a sufficient version without probing package managers', async () => {
    vi.mocked(spawn).mockResolvedValue({
      code: 0,
      stdout: 'gcc 13.2.0',
      stderr: '',
      pid: 0,
    })
    expect(await ensureGccVersion({ quiet: true })).toEqual({
      available: true,
      installed: false,
      version: '13.2.0',
    })
    expect(vi.mocked(detectPackageManagers).mock.calls).toHaveLength(0)
  })

  test('does not probe installation when disabled', async () => {
    expect(await ensureGccVersion({ autoInstall: false, quiet: true })).toEqual(
      { available: false, installed: false, version: '11.2.0' },
    )
    expect(vi.mocked(getPlatform).mock.calls).toHaveLength(0)
  })

  test('rejects unsupported platforms before package-manager detection', async () => {
    vi.mocked(getPlatform).mockReturnValue('darwin')
    expect((await ensureGccVersion({ quiet: true })).available).toBe(false)
    expect(vi.mocked(detectPackageManagers).mock.calls).toHaveLength(0)
    expect(vi.mocked(spawn).mock.calls.map(call => call[1])).toEqual([
      ['--version'],
    ])
  })

  test('rejects Linux without apt before installation', async () => {
    vi.mocked(detectPackageManagers).mockReturnValue(['dnf'])
    expect((await ensureGccVersion({ quiet: true })).available).toBe(false)
    expect(vi.mocked(spawn).mock.calls.map(call => call[1])).toEqual([
      ['--version'],
    ])
  })
})
