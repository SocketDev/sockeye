import { beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdir: vi.fn(),
  win: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  substep: vi.fn(),
  parse: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  promises: { ...(await original()).promises, mkdir: io.mkdir },
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/constants/platform'), () => ({
  isWin32: io.win,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    info: io.info,
    substep: io.substep,
    warn: vi.fn(),
  }),
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: io.error }))
vi.mock(import('../lib/emscripten-environment.mts'), () => ({
  getEmsdkPath: () => '/example/default-sdk',
  getEmsdkSpawnEnv: () => ({ EXAMPLE_BUILD: '1' }),
  parseEmsdkEnvironment: io.parse,
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  io.win.mockReturnValue(false)
  io.spawn.mockResolvedValue({
    code: 0,
    stdout: 'EMSDK=/example/sdk',
    stderr: '',
  })
  io.mkdir.mockResolvedValue(undefined)
  io.parse.mockReturnValue({ EMSDK: '/example/sdk' })
})
test.each([false, true])(
  'activation uses target shell and verbose output on Windows=%s',
  async windows => {
    io.win.mockReturnValue(windows)
    const { activateEmsdkVersion } =
      await import('../lib/emscripten-commands.mts')
    expect(
      await activateEmsdkVersion({
        emsdkPath: '/example/sdk',
        quiet: false,
        version: '4.0.0',
      }),
    ).toBe(true)
    expect(io.spawn).toHaveBeenCalledWith(
      windows ? 'emsdk.bat' : './emsdk',
      ['activate', '4.0.0'],
      expect.objectContaining({
        cwd: '/example/sdk',
        shell: windows,
        stdio: 'inherit',
        env: { EXAMPLE_BUILD: '1' },
      }),
    )
    expect(io.info).toHaveBeenCalledOnce()
  },
)
test.each([false, true])(
  'installation failure returns false and respects quiet=%s',
  async quiet => {
    io.spawn.mockRejectedValue(
      Object.assign(new Error('Fixture install failure'), {
        code: 1,
        stdout: '',
        stderr: '',
      }),
    )
    const { installEmsdkVersion } =
      await import('../lib/emscripten-commands.mts')
    expect(await installEmsdkVersion({ quiet })).toBe(false)
    expect(io.error).toHaveBeenCalledTimes(quiet ? 0 : 1)
    expect(io.spawn).toHaveBeenCalledWith(
      './emsdk',
      ['install', 'latest'],
      expect.objectContaining({ cwd: '/example/default-sdk' }),
    )
  },
)
test.each([false, true])(
  'clone prepares its directory and respects quiet=%s',
  async quiet => {
    const { cloneEmsdkCheckout } =
      await import('../lib/emscripten-commands.mts')
    expect(await cloneEmsdkCheckout({ emsdkPath: '/example/sdk', quiet })).toBe(
      true,
    )
    expect(io.mkdir).toHaveBeenCalledWith('/example/sdk', { recursive: true })
    expect(io.mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      io.spawn.mock.invocationCallOrder[0],
    )
    expect(io.spawn).toHaveBeenCalledWith(
      'git',
      ['clone', 'https://github.com/emscripten-core/emsdk.git', '/example/sdk'],
      expect.objectContaining({ stdio: quiet ? 'pipe' : 'inherit' }),
    )
    expect(io.substep).toHaveBeenCalledTimes(quiet ? 0 : 1)
  },
)
test.each([false, true])(
  'sources the SDK environment on Windows=%s',
  async windows => {
    io.win.mockReturnValue(windows)
    const { readEmsdkEnvironment } =
      await import('../lib/emscripten-commands.mts')
    expect(
      await readEmsdkEnvironment({ emsdkPath: '/example/sdk', quiet: true }),
    ).toEqual({ EMSDK: '/example/sdk' })
    expect(io.spawn).toHaveBeenCalledWith(
      windows ? 'emsdk_env.bat' : 'bash',
      windows ? [] : ['-c', 'source ./emsdk_env.sh && env'],
      expect.objectContaining({ cwd: '/example/sdk', shell: windows }),
    )
    expect(io.parse).toHaveBeenCalledWith('EMSDK=/example/sdk', '/example/sdk')
  },
)
test.each([
  'activateEmsdkVersion',
  'cloneEmsdkCheckout',
  'readEmsdkEnvironment',
] as const)('%s propagates default-spawn rejection', async method => {
  const failure = Object.assign(new Error('Fixture process failure'), {
    code: 1,
    stdout: '',
    stderr: '',
  })
  io.spawn.mockRejectedValue(failure)
  const commands = await import('../lib/emscripten-commands.mts')
  await expect(
    commands[method]({
      emsdkPath: '/example/sdk',
      quiet: false,
      version: '4.0.0',
    }),
  ).rejects.toBe(failure)
})

test('default installation resolves the SDK and succeeds after the child completes', async () => {
  const { installEmsdkVersion } = await import('../lib/emscripten-commands.mts')
  expect(await installEmsdkVersion()).toBe(true)
  expect(io.spawn).toHaveBeenCalledWith(
    './emsdk',
    ['install', 'latest'],
    expect.objectContaining({ cwd: '/example/default-sdk', stdio: 'inherit' }),
  )
  expect(io.error).not.toHaveBeenCalled()
})
test('quiet activation suppresses progress and captures child output', async () => {
  const { activateEmsdkVersion } =
    await import('../lib/emscripten-commands.mts')
  expect(
    await activateEmsdkVersion({
      emsdkPath: '/example/sdk',
      quiet: true,
      version: '4.0.0',
    }),
  ).toBe(true)
  expect(io.info).not.toHaveBeenCalled()
  expect(io.spawn).toHaveBeenCalledWith(
    './emsdk',
    ['activate', '4.0.0'],
    expect.objectContaining({ stdio: 'pipe' }),
  )
})
