import process from 'node:process'
import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  compileReleaseBinary,
  configureReleaseBinary,
  convertToVcbuildFlags,
  refreshReleaseNinja,
} from '../../scripts/binary-released/shared/release-compile.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  stat: vi.fn(),
  spawn: vi.fn(),
  remove: vi.fn(),
  win: vi.fn(),
  env: vi.fn(),
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  lastLines: vi.fn(),
  printError: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
  promises: { ...(await original()).promises, stat: io.stat },
}))
vi.mock(import('node:os'), async importOriginal => {
  const original = await importOriginal()
  const host = {
    ...original.default,
    cpus: () =>
      Array.from({ length: 4 }, () => ({
        model: 'fixture',
        speed: 1000,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
      })),
    totalmem: () => 8 * 1024 ** 3,
  }
  return { ...original, ...host, default: host }
})
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), isWin32: io.win }),
)
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async original => ({
    ...(await original()),
    whichSync: () => '/example/ninja',
  }),
)
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: io.remove,
}))
vi.mock(import('@socketsecurity/lib-stable/env/rewire'), () => ({
  getEnvValue: io.env,
}))
vi.mock(import('local-build-infra/lib/build-operations'), async original => ({
  ...(await original()),
  getLastLogLines: io.lastLines,
}))
vi.mock(import('local-build-infra/lib/build-output'), () => ({
  printError: io.printError,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    log: io.log,
    error: io.error,
    warn: io.warn,
    step: vi.fn(),
    success: vi.fn(),
    fail: vi.fn(),
  }),
}))
const config = {
  buildDir: '/example/build',
  buildEnv: { CFLAGS: 'fixture' },
  configureArgs: ['--ninja'],
  jobCount: 2,
  modeSourceDir: '/example/source',
  platform: 'linux',
}
beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(false)
  io.stat.mockResolvedValue({ mtimeMs: 1 })
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '', pid: 123 })
  io.win.mockReturnValue(false)
  io.env.mockReturnValue(undefined)
  io.lastLines.mockResolvedValue('')
})
test.each([1, 4])(
  'runs Ninja after nonfatal AppleDouble cleanup failure with %s jobs',
  async jobCount => {
    io.spawn.mockRejectedValueOnce(
      Object.assign(new Error('Fixture find unavailable'), { code: 'ENOENT' }),
    )
    await compileReleaseBinary({ ...config, jobCount })
    expect(io.spawn).toHaveBeenLastCalledWith(
      '/example/ninja',
      ['-C', 'out/Release', `-j${jobCount}`],
      { cwd: config.modeSourceDir, env: process.env, stdio: 'inherit' },
    )
  },
)
test('honors the configured job override and performs metadata cleanup', async () => {
  io.env.mockImplementation(name => (name === 'BUILD_JOBS' ? '2' : undefined))
  await compileReleaseBinary(config)
  expect(io.spawn).toHaveBeenNthCalledWith(
    1,
    'find',
    [config.modeSourceDir, '-name', '._*', '-type', 'f', '-delete'],
    { stdio: 'pipe' },
  )
  expect(io.log.mock.calls.flat().join('\n')).toContain('BUILD_JOBS override')
})
test.each(['', 'fixture compiler diagnostic'])(
  'preserves rejected compilation and reports log tail %s',
  async tail => {
    const failure = Object.assign(new Error('Fixture Ninja failure'), {
      code: 1,
      stdout: '',
      stderr: 'fixture',
    })
    io.spawn.mockRejectedValue(failure)
    io.lastLines.mockResolvedValue(tail)
    await expect(
      compileReleaseBinary({ ...config, platform: 'darwin' }),
    ).rejects.toBe(failure)
    expect(io.lastLines).toHaveBeenCalledWith(config.buildDir, 100)
    expect(io.printError).toHaveBeenCalledOnce()
    if (tail) {
      expect(io.error).toHaveBeenCalledWith(tail)
    }
    expect(io.log).toHaveBeenCalledWith('::endgroup::')
  },
)
test('cleans output and stale Windows junctions before vcbuild with shell semantics', async () => {
  io.win.mockReturnValue(true)
  io.exists.mockReturnValue(true)
  const result = await configureReleaseBinary({
    configureFlags: ['--dest-cpu=x64', '--with-intl=none'],
    modeSourceDir: config.modeSourceDir,
    outDir: '/example/source/out',
  })
  expect(io.remove).toHaveBeenCalledExactlyOnceWith('/example/source/out')
  expect(io.spawn).toHaveBeenNthCalledWith(
    1,
    'cmd.exe',
    ['/c', 'rd /S /Q "Release"'],
    expect.objectContaining({ cwd: config.modeSourceDir }),
  )
  expect(io.spawn).toHaveBeenNthCalledWith(
    2,
    'cmd.exe',
    ['/c', 'rd /S /Q "Debug"'],
    expect.objectContaining({ cwd: config.modeSourceDir }),
  )
  expect(io.spawn).toHaveBeenLastCalledWith(
    'vcbuild.bat',
    ['openssl-no-asm', 'download-all', 'x64', 'intl-none'],
    expect.objectContaining({ shell: isWin32(), env: result.buildEnv }),
  )
})
test('maps Windows options and warns on unsupported unknown switches', () => {
  expect(
    convertToVcbuildFlags([
      '--without-node-options',
      '--without-snapshot',
      '--experimental-enable-pointer-compression',
      '--example-unknown',
    ]),
  ).toEqual(['openssl-no-asm', 'download-all', 'no-NODE-OPTIONS', 'nosnapshot'])
  expect(io.warn).toHaveBeenCalledOnce()
})
test('refreshes stale Windows metadata with the original environment', async () => {
  io.win.mockReturnValue(true)
  io.stat
    .mockResolvedValueOnce({ mtimeMs: 1 })
    .mockResolvedValueOnce({ mtimeMs: 2 })
  await refreshReleaseNinja(config.modeSourceDir, config)
  expect(io.spawn).toHaveBeenCalledExactlyOnceWith(
    'vcbuild.bat',
    config.configureArgs,
    {
      cwd: config.modeSourceDir,
      env: config.buildEnv,
      shell: isWin32(),
      stdio: 'inherit',
    },
  )
})

vi.mock(import('../../scripts/binary-released/shared/paths.mts'), () => ({
  getReleaseNinjaPaths: (root: string) => ({
    ninjaPath: `${root}/out/Release/build.ninja`,
    gypPath: `${root}/node.gyp`,
  }),
  getReleaseWindowsConfigurationPath: (root: string, configuration: string) =>
    `${root}/${configuration}`,
}))
