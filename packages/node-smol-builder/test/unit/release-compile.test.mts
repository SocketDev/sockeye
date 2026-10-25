import { beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import {
  compileReleaseBinary,
  configureReleaseBinary,
  convertToVcbuildFlags,
  refreshReleaseNinja,
} from '../../scripts/binary-released/shared/release-compile.mts'

const io = vi.hoisted(() => ({ stat: vi.fn(), exec: vi.fn(), log: vi.fn() }))
vi.mock(import('node:fs'), async importOriginal => {
  const original = await importOriginal()
  return { ...original, promises: { ...original.promises, stat: io.stat } }
})
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.exec,
}))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async importOriginal => ({
    ...(await importOriginal()),
    isWin32: () => false,
  }),
)

vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async importOriginal => ({
    ...(await importOriginal()),
    whichSync: () => '/example/ninja',
  }),
)

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    log: io.log,
    step: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    fail: vi.fn(),
  }),
}))

const config = {
  buildEnv: { CFLAGS: 'example-flag' },
  configureArgs: ['--without-npm'],
}

beforeEach(() => {
  vi.clearAllMocks()
  io.exec.mockResolvedValue({ code: 0, stdout: '', stderr: '', pid: 0 })
  io.stat.mockResolvedValue({ mtimeMs: 1000 })
})

test('refreshes stale Ninja metadata using the configuration arguments and environment', async () => {
  io.stat
    .mockResolvedValueOnce({ mtimeMs: 1000 })
    .mockResolvedValueOnce({ mtimeMs: 2000 })
  await refreshReleaseNinja('/example/source', config)
  expect(io.exec).toHaveBeenCalledExactlyOnceWith(
    './configure',
    config.configureArgs,
    {
      cwd: '/example/source',
      env: config.buildEnv,
      shell: false,
      stdio: 'inherit',
    },
  )
})

test('does not configure when Ninja metadata is current', async () => {
  await refreshReleaseNinja('/example/source', config)
  expect(io.exec).not.toHaveBeenCalled()
})

test('leaves missing metadata to the main compiler invocation', async () => {
  io.stat.mockRejectedValue(new Error('Fixture metadata missing'))
  await refreshReleaseNinja('/example/source', config)
  expect(io.exec).not.toHaveBeenCalled()
})

test('carries the initial configuration into stale metadata refresh before Ninja compilation', async () => {
  const configured = await configureReleaseBinary({
    configureFlags: ['--without-npm'],
    modeSourceDir: '/example/source',
    outDir: '/example/out',
  })
  io.stat
    .mockResolvedValueOnce({ mtimeMs: 1000 })
    .mockResolvedValueOnce({ mtimeMs: 2000 })
  await compileReleaseBinary({
    ...configured,
    buildDir: '/example/build',
    jobCount: 2,
    modeSourceDir: '/example/source',
    platform: 'darwin',
  })
  expect(io.exec).toHaveBeenNthCalledWith(2, './configure', ['--without-npm'], {
    cwd: '/example/source',
    env: configured.buildEnv,
    shell: false,
    stdio: 'inherit',
  })
  expect(io.log.mock.calls.flat().join('\n')).not.toMatch(/undefined|NaN/)
  expect(io.exec).toHaveBeenLastCalledWith(
    '/example/ninja',
    ['-C', 'out/Release', '-j2'],
    { cwd: '/example/source', env: process.env, stdio: 'inherit' },
  )
})

test('maps supported Windows configure flags and omits unsupported feature switches', () => {
  expect(
    convertToVcbuildFlags([
      '--dest-cpu=arm64',
      '--with-intl=small-icu',
      '--enable-lto',
      '--without-npm',
      '--without-smol-ai',
      '--ninja',
    ]),
  ).toEqual([
    'openssl-no-asm',
    'download-all',
    'arm64',
    'full-icu',
    'ltcg',
    'nonpm',
  ])
})
