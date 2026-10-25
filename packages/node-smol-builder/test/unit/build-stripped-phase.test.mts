import { beforeEach, expect, test, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import {
  buildStripped,
  reportStrippedBinarySize,
  stripPlatformBinary,
} from '../../scripts/binary-stripped/shared/build-stripped.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  checkpoint: vi.fn(),
  exec: vi.fn(),
  size: vi.fn(),
  smoke: vi.fn(),
  tool: vi.fn(),
  which: vi.fn(),
  warn: vi.fn(),
  log: vi.fn(),
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  io.exists.mockImplementation(actual.existsSync)
  return {
    ...actual,
    existsSync: io.exists,
    promises: { ...actual.promises, cp: vi.fn(), readdir: vi.fn() },
  }
})
vi.mock(import('../../scripts/binary-stripped/shared/paths.mts'), () => ({
  PACKAGE_ROOT: '/example/package',
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.exec,
}))
vi.mock(import('local-build-infra/lib/build-operations'), async original => ({
  ...(await original()),
  createCheckpoint: io.checkpoint,
  getFileSize: io.size,
  smokeTestBinary: io.smoke,
}))
vi.mock(import('local-build-infra/lib/tool-installer'), () => ({
  ensureToolInstalled: io.tool,
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: io.which,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(),
  safeMkdir: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    step: vi.fn(),
    log: io.log,
    substep: vi.fn(),
    success: vi.fn(),
    logNewline: vi.fn(),
    skip: vi.fn(),
    warn: io.warn,
    fail: vi.fn(),
  }),
}))
const config = {
  arch: 'arm64',
  binaryName: 'node',
  buildDir: '/example/build',
  buildSourcePaths: ['/example/source'],
  isCrossCompiling: false,
  isProdBuild: true,
  libc: 'glibc',
  nodeVersion: '24.0.0',
  outDir: '/example/build/source/out',
  outputReleaseBinary: '/example/build/release/node',
  outputStrippedBinary: '/example/build/stripped/node',
  outputStrippedDir: '/example/build/stripped',
  packageName: 'example-node',
  platform: 'win32',
  withLief: false,
}
beforeEach(() => {
  vi.resetAllMocks()
  io.exec.mockResolvedValue({ code: 0, stdout: '', stderr: '', pid: 0 })
  io.size.mockResolvedValue('25M')
  io.smoke.mockResolvedValue(true)
  io.tool.mockResolvedValue({ available: false })
  io.exists.mockReturnValue(true)
  io.checkpoint.mockImplementation(async (dir, name, validate) => {
    await validate()
  })
  vi.mocked(fs.readdir).mockResolvedValue(['node', 'stale.o'])
})
test.each([
  'arch',
  'binaryName',
  'buildDir',
  'outputReleaseBinary',
  'outputStrippedBinary',
  'outputStrippedDir',
  'platform',
])('rejects missing %s before side effects', async key => {
  await expect(buildStripped({ ...config, [key]: undefined })).rejects.toThrow()
  expect(fs.cp).not.toHaveBeenCalled()
  expect(safeDelete).not.toHaveBeenCalled()
})
test.each([true, false])(
  'copies the release binary and validates checkpoint with crossCompile=%s',
  async cross => {
    await buildStripped({
      ...config,
      isCrossCompiling: cross,
      isProdBuild: !cross,
      libc: cross ? 'musl' : 'glibc',
    })
    expect(fs.cp).toHaveBeenCalledExactlyOnceWith(
      config.outputReleaseBinary,
      config.outputStrippedBinary,
      { force: true, preserveTimestamps: true },
    )
    expect(safeDelete).toHaveBeenCalledWith(config.outDir)
    expect(safeDelete).toHaveBeenCalledWith('/example/build/stripped/stale.o')
    expect(safeDelete).not.toHaveBeenCalledWith(config.outputReleaseBinary)
    expect(safeDelete).not.toHaveBeenCalledWith(config.outputStrippedBinary)
    expect(io.smoke.mock.calls.at(-1)).toEqual([
      config.outputStrippedBinary,
      { arch: cross ? 'arm64' : undefined, libc: cross ? 'musl' : 'glibc' },
    ])
    expect(io.checkpoint.mock.calls[0]?.[3]).toMatchObject({
      artifactPath: config.outputStrippedDir,
      binaryPath: 'stripped/node',
      sourcePaths: config.buildSourcePaths,
      buildMode: cross ? 'dev' : 'prod',
      withLief: false,
    })
  },
)
test('still smoke-tests when checkpoint creation is disabled', async () => {
  io.exists.mockReturnValue(false)
  await buildStripped(config, { skipCheckpoint: true })
  expect(io.smoke).toHaveBeenCalledTimes(1)
  expect(io.checkpoint).not.toHaveBeenCalled()
  expect(fs.readdir).not.toHaveBeenCalled()
  expect(safeDelete).not.toHaveBeenCalled()
})
test.each([0, 1])('refuses corruption at smoke-test phase %s', async phase => {
  if (phase === 1) {
    io.smoke.mockResolvedValueOnce(true)
  }
  io.smoke.mockResolvedValue(false)
  await expect(buildStripped(config)).rejects.toThrow()
  expect(io.checkpoint).toHaveBeenCalledTimes(phase)
})
test.each(['25M', '10M', '40M', '32M', '3G', 'unknown'])(
  'reports size classification for %s',
  size => {
    reportStrippedBinarySize(size)
    expect(io.warn).toHaveBeenCalledTimes(
      size === '10M' || size === '40M' ? 1 : 0,
    )
    if (size === '25M') {
      expect(io.log).toHaveBeenCalledTimes(1)
    }
  },
)
test('handles unavailable Linux optimization tools and macOS tool diagnostics', async () => {
  await stripPlatformBinary('/example/node', {
    arch: 'arm64',
    platform: 'linux',
  })
  expect(io.exec.mock.calls).toEqual([
    ['strip', ['--strip-debug', '/example/node'], { stdio: 'inherit' }],
  ])
  io.tool.mockResolvedValue({
    available: false,
    error: 'fixture tool unavailable',
  })
  await stripPlatformBinary('/example/node', {
    arch: 'arm64',
    platform: 'darwin',
  })
  expect(io.exec).toHaveBeenLastCalledWith('strip', ['-x', '/example/node'], {
    stdio: 'inherit',
  })
  expect(io.warn).toHaveBeenCalledTimes(1)
})
