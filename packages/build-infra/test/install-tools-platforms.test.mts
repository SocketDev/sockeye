import { beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({
  platform: 'linux',
  spawn: vi.fn(),
  version: vi.fn(),
}))
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
  getToolVersion: io.version,
}))
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  io.platform = 'linux'
  io.version.mockReturnValue('1.2.3')
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '', pid: 0 })
})
async function installer() {
  return await import('../lib/install-tools.mts')
}

test.each(['choco', 'scoop', 'missing'])(
  'Windows detection selects %s by priority',
  async manager => {
    io.platform = 'win32'
    io.spawn.mockImplementation(async (command: string, args: string[]) => {
      if (args[0] !== manager) {
        throw new Error('example manager missing')
      }
      return { code: 0, stdout: '' }
    })
    const api = await installer()
    expect(await api.detectPackageManager()).toBe(
      manager === 'missing' ? undefined : manager,
    )
    expect(io.spawn.mock.calls.every(call => call[0] === 'where')).toBe(true)
  },
)

test.each(['apt', 'yum', 'dnf', 'apk', 'missing'])(
  'Linux detection selects %s from successful probes',
  async manager => {
    io.spawn.mockImplementation(async (command: string, args: string[]) => {
      if (args[0] !== manager) {
        throw new Error('example manager missing')
      }
      return { code: 0, stdout: '' }
    })
    const api = await installer()
    expect(await api.detectPackageManager()).toBe(
      manager === 'missing' ? undefined : manager,
    )
    expect(io.spawn).toHaveBeenCalledTimes(4)
  },
)

test('macOS detection reports a missing Homebrew command', async () => {
  io.platform = 'darwin'
  io.spawn.mockRejectedValue(new Error('example brew missing'))
  const api = await installer()
  expect(await api.detectPackageManager()).toBeUndefined()
})

test('missing tools fail when no package manager exists', async () => {
  io.spawn.mockRejectedValue(new Error('example executable missing'))
  const api = await installer()
  expect(await api.isToolInstalled('example-tool')).toBe(false)
  await expect(api.installTool('example-tool')).rejects.toThrow()
})

test('missing pins use the documented unpinned install path', async () => {
  io.version.mockImplementation(() => {
    throw new Error('example missing pin')
  })
  const api = await installer()
  expect(await api.installTool('example-tool', { force: true })).toBe(true)
  expect(io.spawn.mock.calls.at(-1)?.[1]).toEqual([
    'apt-get',
    'install',
    '-y',
    'example-tool',
  ])
})

test('batch installation reports independent failures and successes', async () => {
  const api = await installer()
  io.spawn.mockImplementation(async (command: string, args: string[]) => {
    if (command === 'sudo' && args.at(-1)?.startsWith('failed-tool')) {
      throw new Error('example install failure')
    }
    return { code: 0, stdout: '' }
  })
  expect(
    await api.installTools(['failed-tool', 'working-tool'], { force: true }),
  ).toEqual({ failed: ['failed-tool'], installed: ['working-tool'] })
  expect(
    await api.installTools(['first-tool', 'second-tool'], { force: true }),
  ).toEqual({ failed: [], installed: ['first-tool', 'second-tool'] })
})

test.each([true, false])(
  'apt cache update handles rejected=%s without blocking callers',
  async rejected => {
    const api = await installer()
    io.spawn.mockImplementation(async (command: string) => {
      if (rejected && command === 'sudo') {
        throw new Error('example cache update failure')
      }
      return { code: 0, stdout: '' }
    })
    await expect(api.updatePackageCache()).resolves.toBeUndefined()
    expect(io.spawn).toHaveBeenLastCalledWith('sudo', ['apt-get', 'update'], {
      stdio: 'inherit',
    })
  },
)
