import { beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  which: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    existsSync: io.exists,
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
  io.exists.mockReturnValue(false)
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- whichSync returns null when no executable is found.
  io.which.mockReturnValue(null)
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
})

test('failed initialization suppresses repeated venv detection in both command resolvers', async () => {
  const api = await import('../lib/python-installer.mts')
  expect(
    await api.initializeVenv({ quiet: true, venvDir: '/example/venv' }),
  ).toBe(false)
  io.exists.mockClear()
  expect(api.getPipCommand()).toBeUndefined()
  expect(await api.getPythonCommand()).toBeUndefined()
  expect(io.exists).not.toHaveBeenCalled()
  expect(io.spawn).not.toHaveBeenCalled()
})

test.each(['missing-binaries', 'launch-rejection'])(
  'quiet venv creation handles %s without claiming availability',
  async scenario => {
    const api = await import('../lib/python-installer.mts')
    if (scenario === 'launch-rejection') {
      io.spawn.mockRejectedValueOnce(
        Object.assign(new Error('example venv launch failure'), {
          code: 'ENOENT',
        }),
      )
    }
    expect(
      await api.createPythonVenv({
        targetVenvPath: '/example/venv',
        potentialPip: '/example/venv/bin/pip',
        potentialPython: '/example/venv/bin/python',
        systemPython: 'example-python',
        quiet: true,
      }),
    ).toBe(false)
    expect(api.venvAvailable).toBe(false)
    expect(io.spawn).toHaveBeenCalledOnce()
  },
)
