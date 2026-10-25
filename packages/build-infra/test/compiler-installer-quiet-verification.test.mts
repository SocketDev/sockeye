import { beforeEach, expect, test, vi } from 'vitest'
import { ensureGccVersion } from '../lib/compiler-installer.mts'

const io = vi.hoisted(() => ({
  spawn: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
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
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    substep: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    success: io.success,
  }),
}))
vi.mock(import('../lib/build-output.mts'), () => ({ printError: io.error }))
beforeEach(() => {
  vi.resetAllMocks()
})

test.each([true, false])(
  'quiet installation preserves verified availability=%s without emitting results',
  async sufficient => {
    let probes = 0
    io.spawn.mockImplementation(async (command: string) => {
      if (command === 'gcc') {
        probes += 1
      }
      return {
        code: 0,
        stdout:
          command === 'gcc'
            ? probes === 1 || !sufficient
              ? 'gcc 11.2.0'
              : 'gcc 12.2.0'
            : '',
        stderr: '',
        pid: 0,
      }
    })
    expect(await ensureGccVersion({ quiet: true })).toEqual({
      available: sufficient,
      installed: sufficient,
      version: sufficient ? '12.2.0' : '11.2.0',
    })
    expect(probes).toBe(2)
    expect(io.spawn).toHaveBeenCalledTimes(5)
    expect(io.success).not.toHaveBeenCalled()
    expect(io.error).not.toHaveBeenCalled()
  },
)
