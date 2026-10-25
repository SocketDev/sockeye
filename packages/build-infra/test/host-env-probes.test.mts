import { beforeEach, expect, test, vi } from 'vitest'
const host = vi.hoisted(() => ({
  windows: false,
  ci: false,
  exists: vi.fn(),
  statfs: vi.fn(),
  which: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    existsSync: host.exists,
    promises: { ...actual.promises, statfs: host.statfs },
  }
})
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async original => ({ ...(await original()), whichSync: host.which }),
)
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), isWin32: () => host.windows }),
)
vi.mock(import('@socketsecurity/lib-stable/env/ci'), async original => ({
  ...(await original()),
  isCI: () => host.ci,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: host.spawn,
}))
vi.mock(import('../lib/which-required.mts'), () => ({
  whichRequired: async (command: string) => command,
}))
vi.mock(import('../lib/version-metadata.mts'), () => ({
  getMinPythonVersion: () => '3.12',
}))
vi.mock(import('../lib/ci-cleanup-paths.mts'), () => ({
  getCleanupPaths: () => [{ desc: 'example cache', path: '/example/cache' }],
}))
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  host.windows = false
  host.ci = false
  host.exists.mockReturnValue(true)
  host.spawn.mockResolvedValue({ code: 0, stdout: '200', stderr: '', pid: 0 })
})
async function loadChecks() {
  return await import('../lib/host-env-checks.mts')
}

test('compiler search skips empty names and stops at the first executable', async () => {
  const { checkCompiler } = await loadChecks()
  host.which
    .mockReturnValueOnce(undefined)
    .mockReturnValueOnce('/example/compiler')
  expect(await checkCompiler()).toEqual({ available: true, compiler: 'g++' })
  expect(host.which.mock.calls.map(call => call[0])).toEqual(['clang++', 'g++'])
  host.which.mockReset()
  expect(await checkCompiler(['', 'missing-compiler'])).toEqual({
    available: false,
    compiler: undefined,
  })
  host.which.mockReturnValue('/example/custom')
  expect(await checkCompiler('custom')).toEqual({
    available: true,
    compiler: 'custom',
  })
})

test('disk checks use available blocks and fall back to a missing directory parent', async () => {
  const { checkDiskSpace } = await loadChecks()
  host.statfs.mockResolvedValue({ bavail: 2 * 1024 * 1024, bsize: 1024 })
  expect(await checkDiskSpace('/example/build', 1)).toEqual({
    availableGB: 2,
    sufficient: true,
  })
  host.exists.mockReturnValue(false)
  expect(await checkDiskSpace('/example/build', 3)).toEqual({
    availableGB: 2,
    sufficient: false,
  })
  expect(host.statfs).toHaveBeenLastCalledWith('/example')
  host.statfs.mockRejectedValue(new Error('example stat failure'))
  expect(await checkDiskSpace('/example/build')).toEqual({
    availableGB: undefined,
    sufficient: true,
  })
})

test.each(['200', '301', '302', '503', ''])(
  'Unix connectivity interprets status %s',
  async statusCode => {
    const { checkNetworkConnectivity } = await loadChecks()
    host.spawn.mockResolvedValue({ code: 0, stdout: statusCode })
    expect(await checkNetworkConnectivity()).toEqual({
      connected: ['200', '301', '302'].includes(statusCode),
      statusCode,
    })
    expect(host.spawn.mock.calls[0]?.[0]).toBe('curl')
  },
)

test.each(['200', '0'])(
  'Windows connectivity interprets status %s',
  async statusCode => {
    host.windows = true
    const { checkNetworkConnectivity } = await loadChecks()
    host.spawn.mockResolvedValue({ code: 0, stdout: statusCode })
    expect(await checkNetworkConnectivity()).toEqual({
      connected: statusCode === '200',
      statusCode: statusCode === '200' ? '200' : undefined,
    })
    expect(host.spawn.mock.calls[0]?.[0]).toBe('powershell')
  },
)

test('CI skips connectivity and command rejection reports disconnected', async () => {
  const { checkNetworkConnectivity, checkPythonVersion } = await loadChecks()
  host.ci = true
  expect(await checkNetworkConnectivity()).toEqual({
    connected: true,
    statusCode: 'skipped-in-ci',
  })
  expect(host.spawn).not.toHaveBeenCalled()
  host.ci = false
  host.spawn.mockRejectedValue(new Error('example executable missing'))
  expect(await checkNetworkConnectivity()).toEqual({
    connected: false,
    statusCode: undefined,
  })
  expect(await checkPythonVersion()).toEqual({
    available: false,
    sufficient: false,
    version: undefined,
  })
  host.spawn.mockResolvedValue({ code: 0, stdout: '' })
  expect(await checkPythonVersion()).toEqual({
    available: false,
    sufficient: false,
    version: undefined,
  })
})

test.each(['linux', 'darwin', 'win32'])(
  'cleanup tolerates rejected %s commands',
  async platform => {
    host.windows = platform === 'win32'
    const { cleanupPlatformDisk } = await loadChecks()
    host.spawn.mockRejectedValue(new Error('example denied cleanup'))
    await expect(cleanupPlatformDisk(platform)).resolves.toBeUndefined()
    expect(host.spawn).toHaveBeenCalledTimes(platform === 'win32' ? 1 : 2)
  },
)

test.each([true, false])(
  'Windows disk cleanup tolerates failed probes=%s and still prunes Docker',
  async failed => {
    host.windows = true
    host.ci = true
    const { freeDiskSpace } = await loadChecks()
    host.spawn.mockImplementation(async (command: string) => {
      if (failed && command === 'fsutil') {
        throw new Error('example probe failure')
      }
      return { code: 0, stdout: '' }
    })
    await freeDiskSpace()
    expect(
      host.spawn.mock.calls.filter(call => call[0] === 'fsutil'),
    ).toHaveLength(2)
    expect(host.spawn.mock.calls.some(call => call[0] === 'docker')).toBe(true)
  },
)

test('failed initial Unix disk probe stops cleanup safely', async () => {
  host.ci = true
  const { freeDiskSpace } = await loadChecks()
  host.spawn.mockRejectedValue(new Error('example probe failure'))
  await expect(freeDiskSpace()).resolves.toBeUndefined()
  expect(host.spawn).toHaveBeenCalledOnce()
})
