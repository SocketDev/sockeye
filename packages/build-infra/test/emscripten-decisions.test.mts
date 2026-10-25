import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  activateEmscripten,
  ensureEmscripten,
  getEmscriptenInstructions,
  installEmscripten,
} from '../lib/emscripten-installer.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  which: vi.fn(),
  activate: vi.fn(),
  install: vi.fn(),
  clone: vi.fn(),
  environment: vi.fn(),
  ensureEnvironment: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: io.which,
}))
vi.mock(import('../lib/emscripten-environment.mts'), () => ({
  checkEmsdkInstalled: io.exists,
  ensureEmscriptenEnvironment: io.ensureEnvironment,
  getDefaultEmsdkPath: () => '/example/default-sdk',
  getEmsdkPath: () => '/example/sdk',
  getEmsdkSpawnEnv: () => ({}),
}))
vi.mock(import('../lib/emscripten-commands.mts'), () => ({
  activateEmsdkVersion: io.activate,
  installEmsdkVersion: io.install,
  cloneEmsdkCheckout: io.clone,
  readEmsdkEnvironment: io.environment,
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.exists.mockReturnValue(true)
  io.which.mockImplementation((name: string) =>
    name === 'git' ? '/example/git' : undefined,
  )
  io.activate.mockResolvedValue(true)
  io.install.mockResolvedValue(true)
  io.clone.mockResolvedValue(true)
  io.environment.mockResolvedValue({ EMSDK: '/example/sdk' })
  vi.stubEnv('EMSDK', undefined)
})
afterEach(() => vi.unstubAllEnvs())

test('activation reports missing SDKs and environment acquisition failures', async () => {
  io.exists.mockReturnValue(false)
  expect(await activateEmscripten()).toEqual({ activated: false, env: {} })
  expect(io.activate).not.toHaveBeenCalled()
  io.exists.mockReturnValue(true)
  io.environment.mockRejectedValue(new Error('example source failure'))
  expect(await activateEmscripten()).toEqual({ activated: false, env: {} })
})

test.each([true, false])(
  'existing SDK activation repair installed=%s is bounded',
  async repaired => {
    io.activate.mockResolvedValueOnce(false)
    io.install.mockResolvedValue(repaired)
    expect(await ensureEmscripten({ version: '4.0.0' })).toEqual({
      activated: repaired,
      available: repaired,
      installed: repaired,
    })
    expect(io.install).toHaveBeenCalledExactlyOnceWith({
      emsdkPath: '/example/sdk',
      quiet: false,
      version: '4.0.0',
    })
    expect(io.activate).toHaveBeenCalledTimes(repaired ? 2 : 1)
  },
)

test('existing SDK activation failure honors disabled repairs', async () => {
  io.activate.mockResolvedValue(false)
  expect(await ensureEmscripten({ autoInstall: false })).toEqual({
    activated: false,
    available: false,
    installed: false,
  })
  expect(io.install).not.toHaveBeenCalled()
})

test('fresh SDK installation activates and exports the environment', async () => {
  io.exists.mockReturnValueOnce(false).mockReturnValue(true)
  expect(await ensureEmscripten({ version: '4.0.0' })).toEqual({
    activated: true,
    available: true,
    installed: true,
  })
  expect(io.clone).toHaveBeenCalledWith({
    emsdkPath: '/example/sdk',
    quiet: false,
  })
  expect(io.activate).toHaveBeenCalledTimes(2)
})

test('failed fresh installation remains unavailable', async () => {
  io.exists.mockReturnValue(false)
  io.clone.mockResolvedValue(false)
  expect(await ensureEmscripten()).toEqual({
    activated: false,
    available: false,
    installed: false,
  })
  expect(io.install).not.toHaveBeenCalled()
})

test.each([
  'missing-git',
  'clone-failed',
  'install-failed',
  'activate-failed',
  'thrown',
])('installer stops on %s', async failure => {
  if (failure === 'missing-git') {
    io.which.mockReturnValue(undefined)
  }
  if (failure === 'clone-failed') {
    io.clone.mockResolvedValue(false)
  }
  if (failure === 'install-failed') {
    io.install.mockResolvedValue(false)
  }
  if (failure === 'activate-failed') {
    io.activate.mockResolvedValue(false)
  }
  if (failure === 'thrown') {
    io.clone.mockRejectedValue(new Error('example clone launch failure'))
  }
  expect(await installEmscripten()).toBe(false)
})

test('installation guidance names the selected SDK path', () => {
  expect(
    getEmscriptenInstructions({ installPath: '/example/custom-sdk' }).join(
      '\n',
    ),
  ).toContain('/example/custom-sdk')
})
