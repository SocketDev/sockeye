import { beforeEach, expect, test, vi } from 'vitest'
import {
  checkSpawnResult,
  reportBinaryTestError,
  runBinaryTest,
  runNativeBinaryTests,
  runRosettaBinaryTest,
  smokeTestBinary,
} from '../lib/binary-smoke-test.mts'

const io = vi.hoisted(() => ({
  spawn: vi.fn(),
  sign: vi.fn(),
  verify: vi.fn(),
  docker: vi.fn(),
  strategy: vi.fn(),
  cross: true,
  exists: true,
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: () => io.exists,
}))
vi.mock(import('../lib/sign.mts'), () => ({ adHocSign: io.sign }))
vi.mock(import('../lib/binary-verify.mts'), () => ({
  staticVerifyBinary: io.verify,
  testBinaryWithDocker: io.docker,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/smoke-test-strategy.mts'), async original => ({
  ...(await original()),
  isCrossCompiled: () => io.cross,
  isDockerAvailable: async () => true,
  isQemuAvailable: async () => true,
  isRosettaAvailable: async () => true,
  isSelfExtractingBinary: () => true,
  selectCrossCompileSmokeTestStrategy: io.strategy,
}))

beforeEach(() => {
  vi.resetAllMocks()
  io.exists = true
  io.cross = true
  io.spawn.mockResolvedValue({ code: 0, stdout: 'example output', stderr: '' })
  io.verify.mockResolvedValue(true)
  io.docker.mockResolvedValue(true)
})

test.each(['docker-static', 'qemu-static', 'rosetta-static', 'static'])(
  'uses static validation when strategy is %s',
  async strategy => {
    io.strategy.mockReturnValue(strategy)
    await expect(
      smokeTestBinary('/example/tool', { arch: 'x64', platform: 'darwin' }),
    ).resolves.toBe(true)
    expect(io.verify).toHaveBeenCalledWith('/example/tool', {
      arch: 'x64',
      platform: 'darwin',
      ...(strategy === 'docker-static' ? { static: true } : {}),
    })
    expect(io.spawn).not.toHaveBeenCalled()
  },
)

test('delegates Docker testing with the expected target architecture', async () => {
  io.strategy.mockReturnValue('docker-musl')
  io.docker.mockResolvedValue(false)
  await expect(
    smokeTestBinary('/example/tool', { arch: 'arm64' }),
  ).resolves.toBe(false)
  expect(io.docker).toHaveBeenCalledWith('/example/tool', {
    expectedArch: 'arm64',
  })
  expect(io.verify).not.toHaveBeenCalled()
})

test('uses Rosetta for a runnable cross-compiled binary', async () => {
  io.strategy.mockReturnValue('rosetta-darwin-x64')
  await expect(smokeTestBinary('/example/tool', { arch: 'x64' })).resolves.toBe(
    true,
  )
  expect(io.spawn).toHaveBeenCalledWith(
    'arch',
    ['-x86_64', '/example/tool', '--version'],
    expect.objectContaining({ timeout: 30_000 }),
  )
})

test.each([0, 1, 2, 3])(
  'QEMU execution stops at failing step %s',
  async failAt => {
    io.strategy.mockReturnValue('qemu-arm64')
    let count = 0
    io.spawn.mockImplementation(async () => {
      if (count++ === failAt) {
        throw new Error('Fixture emulated process failed')
      }
      return { code: 0, stdout: 'example output', stderr: '' }
    })
    await expect(
      smokeTestBinary('/example/tool', { arch: 'arm64' }),
    ).resolves.toBe(failAt === 3)
    expect(io.spawn).toHaveBeenCalledTimes(Math.min(failAt + 1, 3))
  },
)

test('custom QEMU arguments execute once', async () => {
  io.strategy.mockReturnValue('qemu-arm64')
  await expect(
    smokeTestBinary('/example/tool', { args: ['--help'] }),
  ).resolves.toBe(true)
  expect(io.spawn).toHaveBeenCalledOnce()
  expect(io.spawn.mock.calls[0]![1]).toEqual(['--help'])
})

test.each([1, 2, 3])(
  'native fixture execution stops at failing step %s',
  async failAt => {
    let count = 0
    io.spawn.mockImplementation(async () => {
      if (count++ === failAt) {
        throw new Error('Fixture native process failed')
      }
      return { code: 0, stdout: 'example output', stderr: '' }
    })
    await expect(runNativeBinaryTests('/example/tool')).resolves.toBe(false)
    expect(io.spawn).toHaveBeenCalledTimes(failAt + 1)
  },
)

test('native binary testing bypasses cross-platform strategy probes', async () => {
  io.cross = false
  await expect(
    smokeTestBinary('/example/tool', { args: ['--version'] }),
  ).resolves.toBe(true)
  expect(io.strategy).not.toHaveBeenCalled()
})

test('missing binary fails before process execution', async () => {
  io.exists = false
  await expect(smokeTestBinary('/example/missing')).resolves.toBe(false)
  expect(io.spawn).not.toHaveBeenCalled()
})

test('signing failure propagates without running the binary', async () => {
  const failure = new Error('Fixture signing failure')
  io.sign.mockRejectedValue(failure)
  await expect(smokeTestBinary('/example/tool')).rejects.toBe(failure)
  expect(io.spawn).not.toHaveBeenCalled()
})

test('Rosetta execution errors fail the smoke test', async () => {
  io.spawn.mockRejectedValue(new Error('Fixture Rosetta unavailable'))
  await expect(runRosettaBinaryTest('/example/tool')).resolves.toBe(false)
})

test('self-extracting binaries receive the diagnostic environment flag', async () => {
  await expect(runBinaryTest('/example/tool', [], 'fixture')).resolves.toBe(
    true,
  )
  expect(io.spawn.mock.calls[0]![2].env.SOCKET_SMOL_DEBUG).toBe('1')
})

test.each([
  new Error('Fixture launch failure'),
  Object.assign(new Error('Fixture timeout'), {
    code: 1,
    signal: 'SIGTERM',
    stdout: '',
    stderr: '',
  }),
  Object.assign(new Error('Fixture exit failure'), {
    code: 2,
    signal: undefined,
    stdout: 'example output',
    stderr: 'example diagnostic',
  }),
])('reports failed execution as false', error => {
  expect(
    reportBinaryTestError({
      error,
      execPath: '/example/tool',
      args: ['--version'],
      testName: 'fixture',
    }),
  ).toBe(false)
})

test('result validation rejects explicit errors and failing exit codes', () => {
  expect(
    checkSpawnResult(
      { error: new Error('Fixture failure') },
      'fixture',
      '/example/tool',
    ),
  ).toBe(false)
  expect(checkSpawnResult({ code: 2 }, 'fixture', '/example/tool')).toBe(false)
  expect(checkSpawnResult({ code: 0 }, 'fixture', '/example/tool')).toBe(true)
})
