import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  activateEmscripten,
  ensureEmscripten,
  installEmscripten,
} from '../lib/emscripten-installer.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  which: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async original => ({ ...(await original()), whichSync: io.which }),
)
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('EMSDK', '/example/sdk')
  vi.stubEnv('EMSCRIPTEN', '')
  io.exists.mockReturnValue(false)
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- whichSync returns null when no executable is found.
  io.which.mockReturnValue(null)
})
afterEach(() => vi.unstubAllEnvs())

test('quiet activation of an absent SDK returns no environment', async () => {
  expect(
    await activateEmscripten({ quiet: true, emsdkPath: '/example/sdk' }),
  ).toEqual({ activated: false, env: {} })
  expect(io.spawn).not.toHaveBeenCalled()
})

test('quiet installation without git fails before any installer process', async () => {
  expect(
    await installEmscripten({ quiet: true, installPath: '/example/sdk' }),
  ).toBe(false)
  expect(io.spawn).not.toHaveBeenCalled()
})

test('quiet ensure reports unavailable when installation prerequisites are missing', async () => {
  expect(await ensureEmscripten({ quiet: true, autoInstall: true })).toEqual({
    activated: false,
    available: false,
    installed: false,
  })
  expect(io.spawn).not.toHaveBeenCalled()
})
