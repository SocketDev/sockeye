import { beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({
  spawn: vi.fn(),
  win: vi.fn(),
  warning: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), isWin32: io.win }),
)
vi.mock(import('@socketsecurity/lib-stable/env/ci'), () => ({
  isCI: () => false,
}))
vi.mock(import('../lib/which-required.mts'), () => ({
  whichRequired: async (name: string) => `/example/${name}`,
}))
vi.mock(import('../lib/version-metadata.mts'), () => ({
  getMinPythonVersion: () => '3.12',
}))
vi.mock(import('../lib/ci-cleanup-paths.mts'), () => ({
  getCleanupPaths: () => [
    { path: '/example/disposable-cache', desc: 'Example cache' },
  ],
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    warn: io.warning,
    success: vi.fn(),
    substep: vi.fn(),
  }),
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  io.win.mockReturnValue(true)
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
})
test('PowerShell failure output is not reported as connectivity', async () => {
  io.spawn.mockResolvedValue({ code: 0, stdout: '0\r\n', stderr: '' })
  const { checkNetworkConnectivity } =
    await import('../lib/host-env-checks.mts')
  expect(await checkNetworkConnectivity()).toEqual({
    connected: false,
    statusCode: undefined,
  })
  expect(io.spawn).toHaveBeenCalledWith(
    '/example/powershell',
    expect.arrayContaining(['-NoProfile']),
  )
})
test('empty Unix HTTP output is disconnected', async () => {
  io.win.mockReturnValue(false)
  const { checkNetworkConnectivity } =
    await import('../lib/host-env-checks.mts')
  expect(await checkNetworkConnectivity()).toEqual({
    connected: false,
    statusCode: '',
  })
})
test('Python falls through an empty successful probe to the alternate executable', async () => {
  io.spawn
    .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    .mockResolvedValueOnce({ code: 0, stdout: '3.12\n', stderr: '' })
  const { checkPythonVersion } = await import('../lib/host-env-checks.mts')
  expect(await checkPythonVersion()).toEqual({
    available: true,
    sufficient: true,
    version: '3.12',
  })
  expect(io.spawn.mock.calls.map(call => call[0])).toEqual([
    'python3',
    'python',
  ])
})
test('Windows cleanup records rejected subprocess diagnostics without deleting local files', async () => {
  const failure = Object.assign(new Error('Fixture cleanup rejected'), {
    code: 1,
    stdout: '',
    stderr: '',
  })
  io.spawn.mockRejectedValue(failure)
  const { cleanupPlatformDisk } = await import('../lib/host-env-checks.mts')
  await cleanupPlatformDisk('win32')
  expect(io.spawn).toHaveBeenCalledWith(
    'powershell',
    expect.arrayContaining(['-Command']),
    { stdio: 'inherit' },
  )
  expect(io.warning).toHaveBeenCalledOnce()
})
