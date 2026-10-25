import { beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

vi.mock(import('node:fs'), async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: { ...actual.promises, mkdir: vi.fn() },
  }
})
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.mocked(existsSync).mockReturnValue(false)
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    pid: 0,
    stdout: '',
    stderr: '',
  })
})

describe('Python virtual environment lifecycle', () => {
  test('reuses an existing environment without running Python', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    const installer = await import('../lib/python-installer.mts')
    expect(
      await installer.initializeVenv({ venvDir: '/example/venv', quiet: true }),
    ).toBe(true)
    expect(installer.getPipCommand()).toBe('/example/venv/bin/pip3')
    expect(await installer.getPythonCommand()).toBe('/example/venv/bin/python3')
    expect(vi.mocked(spawn).mock.calls).toHaveLength(0)
  })

  test('does not retry initialization when no Python was available', async () => {
    const installer = await import('../lib/python-installer.mts')
    expect(
      await installer.initializeVenv({ venvDir: '/example/venv', quiet: true }),
    ).toBe(false)
    expect(
      await installer.initializeVenv({ venvDir: '/example/venv', quiet: true }),
    ).toBe(false)
    expect(vi.mocked(whichSync).mock.calls).toHaveLength(2)
    expect(vi.mocked(fs.mkdir).mock.calls).toHaveLength(0)
  })

  test('creates an environment before upgrading its pip', async () => {
    vi.mocked(whichSync).mockReturnValue('/example/python')
    vi.mocked(spawn).mockImplementation(async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      return { code: 0, pid: 0, stdout: '', stderr: '' }
    })
    const installer = await import('../lib/python-installer.mts')
    expect(
      await installer.initializeVenv({ venvDir: '/example/venv', quiet: true }),
    ).toBe(true)
    expect(vi.mocked(spawn).mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['/example/python', ['-m', 'venv', '/example/venv']],
      ['/example/venv/bin/pip3', ['install', '--upgrade', 'pip']],
    ])
    expect(installer.venvAvailable).toBe(true)
  })

  test('rejects failed environment creation before upgrading pip', async () => {
    vi.mocked(whichSync).mockReturnValue('/example/python')
    vi.mocked(spawn).mockResolvedValue({
      code: 1,
      pid: 0,
      stdout: '',
      stderr: '',
    })
    const installer = await import('../lib/python-installer.mts')
    expect(
      await installer.initializeVenv({ venvDir: '/example/venv', quiet: true }),
    ).toBe(false)
    expect(installer.venvAvailable).toBe(false)
    expect(vi.mocked(spawn).mock.calls).toHaveLength(1)
  })

  test('derives Python from the pip installation prefix', async () => {
    vi.mocked(whichSync).mockReturnValue('/example/pip')
    vi.mocked(existsSync).mockImplementation(
      file => file === '/example/runtime/bin/python3',
    )
    vi.mocked(spawn).mockResolvedValue({
      code: 0,
      pid: 0,
      stdout:
        'pip 25.0 from /example/runtime/lib/python3.12/site-packages/pip (python 3.12)',
      stderr: '',
    })
    const installer = await import('../lib/python-installer.mts')
    expect(await installer.getPythonCommand()).toBe(
      '/example/runtime/bin/python3',
    )
    expect(await installer.getPythonCommand()).toBe(
      '/example/runtime/bin/python3',
    )
    expect(vi.mocked(spawn).mock.calls).toHaveLength(1)
  })

  test('uses PATH when pip output has no installation prefix', async () => {
    vi.mocked(whichSync).mockImplementation(tool =>
      tool === 'pip3' ? '/example/pip' : '/example/system-python',
    )
    const installer = await import('../lib/python-installer.mts')
    expect(await installer.getPythonCommand()).toBe('/example/system-python')
  })
})
