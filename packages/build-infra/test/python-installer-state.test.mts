import { beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({
  platform: 'linux' as NodeJS.Platform,
  exists: vi.fn(),
  list: vi.fn(),
  mkdir: vi.fn(),
  which: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock(import('node:process'), async original => {
  const actual = await original()
  return {
    ...actual,
    default: {
      ...actual.default,
      get platform() {
        return io.platform
      },
    },
  }
})
vi.mock(import('node:os'), async original => {
  const actual = await original()
  return {
    ...actual,
    default: { ...actual.default, homedir: () => '/example/home' },
  }
})
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    existsSync: io.exists,
    readdirSync: io.list,
    promises: { ...actual.promises, mkdir: io.mkdir },
  }
})
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async original => ({ ...(await original()), whichSync: io.which }),
)
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  io.platform = 'linux'
  io.exists.mockReturnValue(false)
  io.list.mockReturnValue([])
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '', pid: 0 })
})
async function loadInstaller() {
  return await import('../lib/python-installer.mts')
}

test('detects and caches managed Python markers while skipping unrelated directories', async () => {
  const api = await loadInstaller()
  io.list.mockReturnValue(['example-library', 'python3.11', 'python3.12'])
  io.exists.mockImplementation(
    (filename: string) => filename === '/usr/lib/python3.12/EXTERNALLY-MANAGED',
  )
  expect(api.isPEP668Managed()).toBe(true)
  io.exists.mockReturnValue(false)
  expect(api.isPEP668Managed()).toBe(true)
  expect(io.list).toHaveBeenCalledOnce()
  api.setCachedPEP668(false)
  expect(api.isPEP668Managed()).toBe(false)
})

test.each(['non-linux', 'missing-marker', 'unreadable'])(
  'managed detection handles %s',
  async scenario => {
    io.platform = scenario === 'non-linux' ? 'darwin' : 'linux'
    if (scenario === 'unreadable') {
      io.list.mockImplementation(() => {
        throw new Error('example unreadable lib')
      })
    }
    const api = await loadInstaller()
    expect(api.isPEP668Managed()).toBe(false)
  },
)

test.each(['pip3', 'pip', 'missing'])(
  'resolves %s pip availability',
  async command => {
    io.which.mockImplementation((name: string) =>
      name === command ? `/example/bin/${name}` : undefined,
    )
    const api = await loadInstaller()
    expect(api.checkPipAvailable()).toBe(command !== 'missing')
    expect(api.getPipCommand()).toBe(
      command === 'missing' ? undefined : `/example/bin/${command}`,
    )
  },
)

test.each(['pip', 'python'])(
  'lazily adopts an existing venv through %s lookup',
  async lookup => {
    io.exists.mockReturnValue(true)
    const api = await loadInstaller()
    if (lookup === 'pip') {
      expect(api.getPipCommand()).toBe(
        '/example/home/.socket-btm-venv/bin/pip3',
      )
    } else {
      expect(await api.getPythonCommand()).toBe(
        '/example/home/.socket-btm-venv/bin/python3',
      )
    }
    expect(api.venvAvailable).toBe(true)
    expect(api.venvInitialized).toBe(true)
    expect(await api.initializeVenv()).toBe(true)
    expect(api.getPipCommand()).toBe('/example/home/.socket-btm-venv/bin/pip3')
    expect(await api.getPythonCommand()).toBe(
      '/example/home/.socket-btm-venv/bin/python3',
    )
    expect(io.spawn).not.toHaveBeenCalled()
  },
)

test('explicit initialization accepts existing binaries', async () => {
  const api = await loadInstaller()
  io.exists.mockReturnValue(true)
  expect(await api.initializeVenv({ venvDir: '/example/venv' })).toBe(true)
  expect(api.getPipCommand()).toBe('/example/venv/bin/pip3')
})

test('missing system Python leaves initialization unavailable without spawning', async () => {
  const api = await loadInstaller()
  expect(await api.initializeVenv()).toBe(false)
  expect(await api.initializeVenv()).toBe(false)
  expect(io.spawn).not.toHaveBeenCalled()
})

test.each(['success', 'missing-binaries', 'create-failure', 'upgrade-failure'])(
  'virtual environment creation handles %s',
  async scenario => {
    const api = await loadInstaller()
    io.which.mockReturnValue('/example/bin/python3')
    io.spawn.mockImplementation(async (command: string, args: string[]) => {
      if (
        (scenario === 'create-failure' && args[0] === '-m') ||
        (scenario === 'upgrade-failure' && args[0] === 'install')
      ) {
        throw new Error(`example ${command} subprocess failure`)
      }
      if (scenario !== 'missing-binaries') {
        io.exists.mockReturnValue(true)
      }
      return { code: 0, stdout: '' }
    })
    expect(await api.initializeVenv({ venvDir: '/example/venv' })).toBe(
      scenario === 'success',
    )
    expect(io.mkdir).toHaveBeenCalledWith('/example', { recursive: true })
    expect(io.spawn.mock.calls[0]).toEqual([
      '/example/bin/python3',
      ['-m', 'venv', '/example/venv'],
      { stdio: 'inherit' },
    ])
    if (scenario === 'success') {
      expect(io.spawn.mock.calls[1]).toEqual([
        '/example/venv/bin/pip3',
        ['install', '--upgrade', 'pip'],
        { stdio: 'inherit' },
      ])
    }
  },
)

test('resolves Python from pip prefix and caches the matching interpreter', async () => {
  const api = await loadInstaller()
  io.which.mockImplementation((name: string) =>
    name === 'pip3' ? '/example/bin/pip3' : undefined,
  )
  io.spawn.mockResolvedValue({
    code: 0,
    stdout:
      'pip 25.0 from /example/lib/python3.12/site-packages/pip (python 3.12)',
  })
  io.exists.mockImplementation(
    (filename: string) => filename === '/example/bin/python3.12',
  )
  expect(await api.getPythonCommand()).toBe('/example/bin/python3.12')
  expect(await api.getPythonCommand()).toBe('/example/bin/python3.12')
  expect(io.spawn).toHaveBeenCalledOnce()
})

test.each(['python3', 'python', 'missing'])(
  'interpreter fallback resolves %s after pip probe failure',
  async command => {
    const api = await loadInstaller()
    io.which.mockImplementation((name: string) =>
      name === 'pip3' || name === command ? `/example/bin/${name}` : undefined,
    )
    io.spawn.mockRejectedValue(new Error('example failed pip probe'))
    expect(await api.getPythonCommand()).toBe(
      command === 'missing' ? undefined : `/example/bin/${command}`,
    )
    expect(await api.getPythonCommand()).toBe(
      command === 'missing' ? undefined : `/example/bin/${command}`,
    )
    expect(io.spawn).toHaveBeenCalledOnce()
  },
)

test('no pip caches unavailable Python and malformed pip output cannot resolve a prefix', async () => {
  const api = await loadInstaller()
  expect(await api.getPythonCommand()).toBeUndefined()
  expect(await api.getPythonCommand()).toBeUndefined()
  expect(io.spawn).not.toHaveBeenCalled()
  io.spawn.mockResolvedValue({ code: 0, stdout: 'unrecognized pip output' })
  expect(await api.resolvePythonFromPip('example-pip')).toBeUndefined()
})
