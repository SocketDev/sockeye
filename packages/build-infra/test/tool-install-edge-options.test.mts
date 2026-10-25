import { beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({ spawn: vi.fn(), platform: 'win32' }))
vi.mock(import('node:os'), async original => {
  const actual = await original()
  return {
    ...actual,
    default: { ...actual.default, platform: () => io.platform },
  }
})
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolVersion: () => '1.2.3',
}))
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  io.platform = 'win32'
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
})

test('Windows installed-tool detection uses where', async () => {
  const api = await import('../lib/install-tools.mts')
  expect(await api.isToolInstalled('example-tool')).toBe(true)
  expect(io.spawn).toHaveBeenCalledExactlyOnceWith('where', ['example-tool'], {
    stdio: 'ignore',
  })
})

test('unversioned Chocolatey installs omit the version option', async () => {
  const api = await import('../lib/install-tools.mts')
  expect(
    api.createToolInstallCommand({
      toolName: 'example-tool',
      pkgMgr: 'choco',
      version: undefined,
    }),
  ).toEqual({ command: 'choco', args: ['install', '-y', 'example-tool'] })
  expect(() =>
    api.createToolInstallCommand({
      toolName: 'example-tool',
      pkgMgr: 'unsupported-manager',
    }),
  ).toThrow()
  expect(io.spawn).not.toHaveBeenCalled()
})

test('non-apt managers do not run package-cache updates', async () => {
  const api = await import('../lib/install-tools.mts')
  await api.updatePackageCache()
  expect(io.spawn).toHaveBeenCalledExactlyOnceWith('where', ['choco'], {
    stdio: 'ignore',
  })
})

test('a mixed batch preserves both successful tools and rejected installations', async () => {
  io.platform = 'linux'
  const api = await import('../lib/install-tools.mts')
  io.spawn.mockImplementation(async (command: string, args: string[]) => {
    if (
      command === 'sudo' &&
      args.some(value => value.startsWith('example-failed'))
    ) {
      throw Object.assign(new Error('example installer failed'), {
        code: 2,
        stdout: '',
        stderr: '',
      })
    }
    return { code: 0, stdout: '', stderr: '' }
  })
  expect(
    await api.installTools(['example-ready', 'example-failed'], {
      force: true,
    }),
  ).toEqual({ installed: ['example-ready'], failed: ['example-failed'] })
})
