import { beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { ensureAllToolsInstalled } from '../lib/tool-installer.mts'
import { checkTools } from '../lib/check-tools.mts'

vi.mock(import('node:fs'), () => ({ existsSync: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/tool-installer.mts'), () => ({
  ensureAllToolsInstalled: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(ensureAllToolsInstalled).mockResolvedValue({
    allAvailable: true,
    installed: [],
    missing: [],
  })
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    pid: 0,
    stdout: '',
    stderr: '',
  })
})

describe('build tool availability', () => {
  test('accepts a static library before probing pkg-config', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    expect(
      await checkTools({
        packageName: 'example-builder',
        autoInstallableTools: [],
        manualTools: [
          {
            name: 'example-library',
            cmd: 'pkg-config',
            args: ['--exists', 'example-library'],
            isLibrary: true,
            filePaths: ['/example/library.a'],
          },
        ],
      }),
    ).toBe(true)
    expect(vi.mocked(whichSync).mock.calls).toHaveLength(0)
    expect(vi.mocked(spawn).mock.calls).toHaveLength(0)
  })

  test('uses pkg-config when a library file is absent', async () => {
    vi.mocked(whichSync).mockReturnValue('/example/pkg-config')
    expect(
      await checkTools({
        packageName: 'example-builder',
        autoInstallableTools: [],
        manualTools: [
          {
            name: 'example-library',
            cmd: 'pkg-config',
            args: ['--exists', 'example-library'],
            isLibrary: true,
          },
        ],
      }),
    ).toBe(true)
    expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([
      'pkg-config',
      ['--exists', 'example-library'],
    ])
  })

  test('reports unavailable libraries when pkg-config throws', async () => {
    vi.mocked(whichSync).mockReturnValue('/example/pkg-config')
    vi.mocked(spawn).mockRejectedValue(new Error('fixture probe failure'))
    expect(
      await checkTools({
        packageName: 'example-builder',
        autoInstallableTools: [],
        manualTools: [
          {
            name: 'example-library',
            cmd: 'pkg-config',
            args: ['--exists', 'example-library'],
            isLibrary: true,
          },
        ],
      }),
    ).toBe(false)
  })

  test('checks every manual binary even when automatic tools are missing', async () => {
    vi.mocked(ensureAllToolsInstalled).mockResolvedValue({
      allAvailable: false,
      installed: [],
      missing: ['example-auto-tool'],
    })
    expect(
      await checkTools(
        {
          packageName: 'example-builder',
          autoInstallableTools: ['example-auto-tool'],
          manualTools: [
            { name: 'first-tool', cmd: 'first-tool' },
            { name: 'second-tool', cmd: 'second-tool' },
          ],
        },
        { autoInstall: false, autoYes: true },
      ),
    ).toBe(false)
    expect(vi.mocked(whichSync).mock.calls.map(call => call[0])).toEqual([
      'first-tool',
      'second-tool',
    ])
    expect(vi.mocked(ensureAllToolsInstalled).mock.calls).toEqual([
      [['example-auto-tool'], { autoInstall: false, autoYes: true }],
    ])
  })
})
