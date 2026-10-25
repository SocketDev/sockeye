import { beforeEach, expect, test, vi } from 'vitest'
import {
  resolveBinarySmokeStrategy,
  runBinaryTest,
  runNativeBinaryTests,
  smokeTestBinary,
} from '../lib/binary-smoke-test.mts'
import {
  BINARY_SMOKE_MODULES_FIXTURE,
  BINARY_SMOKE_SIMPLE_FIXTURE,
  BINARY_SMOKE_TEMPORAL_FIXTURE,
} from '../lib/paths.mts'

const smoke = vi.hoisted(() => ({
  spawn: vi.fn(),
  exists: vi.fn(),
  selfExtracting: vi.fn(),
  docker: vi.fn(),
  qemu: vi.fn(),
  rosetta: vi.fn(),
}))
vi.mock(import('node:fs'), async importOriginal => {
  const original = await importOriginal()
  smoke.exists.mockImplementation(original.existsSync)
  return { ...original, existsSync: smoke.exists }
})
vi.mock(import('../lib/sign.mts'), async importOriginal => ({
  ...(await importOriginal()),
  adHocSign: vi.fn().mockResolvedValue(undefined),
}))
vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: smoke.spawn,
  }),
)
vi.mock(import('../lib/smoke-test-strategy.mts'), async importOriginal => ({
  ...(await importOriginal()),
  isDockerAvailable: smoke.docker,
  isSelfExtractingBinary: smoke.selfExtracting,
  isQemuAvailable: smoke.qemu,
  isRosettaAvailable: smoke.rosetta,
}))
beforeEach(() => {
  smoke.exists.mockReset().mockReturnValue(true)
  smoke.selfExtracting.mockReset().mockReturnValue(false)
  smoke.spawn
    .mockReset()
    .mockResolvedValue({ code: 0, stdout: 'example output' })
  smoke.docker.mockReset().mockResolvedValue(false)
  smoke.qemu.mockReset().mockResolvedValue(false)
  smoke.rosetta.mockReset().mockResolvedValue(false)
})

test('runs the native fixture battery in order', async () => {
  expect(await runNativeBinaryTests('/example/binary')).toBe(true)
  expect(smoke.spawn.mock.calls.map(call => call[1])).toEqual([
    ['--version'],
    [BINARY_SMOKE_SIMPLE_FIXTURE],
    [BINARY_SMOKE_MODULES_FIXTURE],
    [BINARY_SMOKE_TEMPORAL_FIXTURE],
  ])
})
test('stops the native battery after its first failed command', async () => {
  smoke.spawn.mockRejectedValueOnce(
    Object.assign(new Error('Fixture process failed'), { code: 1 }),
  )
  expect(await runNativeBinaryTests('/example/binary')).toBe(false)
  expect(smoke.spawn).toHaveBeenCalledTimes(1)
})
test('uses custom arguments as a single native test', async () => {
  expect(
    await runNativeBinaryTests('/example/binary', { args: ['--help'] }),
  ).toBe(true)
  expect(smoke.spawn.mock.calls.map(call => call[1])).toEqual([['--help']])
})
test('converts a spawn rejection into a failed test', async () => {
  smoke.spawn.mockRejectedValueOnce(new Error('example spawn failure'))
  expect(await runBinaryTest('/example/binary', ['--version'], 'version')).toBe(
    false,
  )
})
test.each([
  {
    platform: 'linux',
    host: 'x64',
    target: 'x64',
    libc: 'musl',
    docker: 1,
    qemu: 0,
    rosetta: 0,
    strategy: 'docker-static',
  },
  {
    platform: 'linux',
    host: 'x64',
    target: 'arm64',
    libc: 'glibc',
    docker: 0,
    qemu: 1,
    rosetta: 0,
    strategy: 'qemu-static',
  },
  {
    platform: 'darwin',
    host: 'arm64',
    target: 'x64',
    libc: 'glibc',
    docker: 0,
    qemu: 0,
    rosetta: 1,
    strategy: 'rosetta-static',
  },
])(
  'probes only relevant $platform tools',
  async ({ platform, host, target, libc, docker, qemu, rosetta, strategy }) => {
    expect(
      await resolveBinarySmokeStrategy('/example/binary', {
        options: { arch: target, libc },
        hostArch: host,
        hostPlatform: platform,
      }),
    ).toBe(strategy)
    expect(smoke.docker).toHaveBeenCalledTimes(docker)
    expect(smoke.qemu).toHaveBeenCalledTimes(qemu)
    expect(smoke.rosetta).toHaveBeenCalledTimes(rosetta)
  },
)

test('retains the outer failure handler for native test preparation', async () => {
  smoke.selfExtracting.mockImplementation(() => {
    throw new Error('example preparation failure')
  })
  expect(await smokeTestBinary('/example/binary')).toBe(false)
  expect(smoke.spawn).not.toHaveBeenCalled()
})
