import { beforeEach, expect, test, vi } from 'vitest'
import { ensureGccVersion } from '../lib/compiler-installer.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn(), error: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  which: async () => '/example/sudo',
}))
vi.mock(import('../lib/build-env.mts'), () => ({ getPlatform: () => 'linux' }))
vi.mock(import('../lib/tool-installer.mts'), () => ({
  detectPackageManagers: () => ['apt'],
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: io.error }))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    substep: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}))
beforeEach(() => {
  vi.clearAllMocks()
})
test('reports a successful package install whose selected GCC still fails version verification', async () => {
  io.spawn.mockImplementation(async (command: string) => ({
    code: 0,
    stdout: command === 'gcc' ? 'gcc (Example) 11.4.0' : '',
    stderr: '',
  }))
  expect(await ensureGccVersion()).toEqual({
    available: false,
    installed: false,
    version: '11.4.0',
  })
  expect(io.error).toHaveBeenCalledWith(
    'GCC installation completed but version check failed',
  )
  expect(io.spawn.mock.calls.filter(call => call[0] === 'gcc')).toHaveLength(2)
})
test('rejects failed apt installation without probing a second compiler version', async () => {
  io.spawn
    .mockResolvedValueOnce({
      code: 0,
      stdout: 'gcc (Example) 11.4.0',
      stderr: '',
    })
    .mockRejectedValueOnce(
      Object.assign(new Error('Fixture apt rejected'), {
        code: 1,
        stdout: '',
        stderr: '',
      }),
    )
  expect(await ensureGccVersion()).toEqual({
    available: false,
    installed: false,
    version: '11.4.0',
  })
  expect(io.spawn).toHaveBeenCalledTimes(2)
})
