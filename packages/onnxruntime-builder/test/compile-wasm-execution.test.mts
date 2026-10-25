import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import process from 'node:process'
import { ensureEmscripten } from 'local-build-infra/lib/emscripten-installer'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { compileWasm } from '../scripts/wasm-compiled/shared/compile-wasm.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  spawn: vi.fn(),
  which: vi.fn(),
  windows: false,
  spinner: { start: vi.fn(), stop: vi.fn(), text: vi.fn() },
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  io.exists.mockImplementation(actual.existsSync)
  return {
    ...actual,
    existsSync: io.exists,
    promises: { ...actual.promises, readFile: vi.fn() },
  }
})
vi.mock(import('local-build-infra/lib/build-operations'), async original => ({
  ...(await original()),
  getFileSize: vi.fn().mockResolvedValue('1 KB'),
}))
vi.mock(import('local-build-infra/lib/emscripten-installer'), () => ({
  ensureEmscripten: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/path-remap-flags'), () => ({
  appendCCRemapFlags: (value: string | undefined) =>
    `${value ?? ''} -ffile-prefix-map=/example=/src`.trim(),
  getCCRemapFlagsString: () => '-ffile-prefix-map=/example=/src',
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: io.which,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), isWin32: () => io.windows }),
)
vi.mock(import('@socketsecurity/lib-stable/spinner/default'), () => ({
  getDefaultSpinner: () => io.spinner,
}))
const config = {
  buildDir: '/example/build',
  buildMode: 'prod',
  buildOutputPaths: {
    buildCmakeCacheFile: '/example/build/CMakeCache.txt',
    buildPostBuildScriptFile: '/example/build/wasm_post_build.js',
    buildWasmFile: '/example/build/Release/onnx.wasm',
  },
  buildScriptFile: '/example/source/build.sh',
  emscriptenVersion: '3.1.0',
  isCI: false,
  modeSourceDir: '/example/source',
}
const exportedMemory = Buffer.from(
  '0061736d010000000503010001070a01066d656d6f72790200',
  'hex',
)
beforeEach(() => {
  vi.clearAllMocks()
  io.spawn
    .mockReset()
    .mockResolvedValue({ code: 0, stdout: '', stderr: '', pid: 0 })
  io.which.mockReset().mockReturnValue('/example/tool')
  io.exists.mockReset().mockReturnValue(true)
  io.windows = false
  vi.mocked(ensureEmscripten).mockResolvedValue({ available: true })
  vi.mocked(fs.readFile).mockResolvedValue(exportedMemory)
  vi.spyOn(process, 'getuid').mockReturnValue(1000)
  vi.spyOn(os, 'cpus').mockReturnValue(
    Array.from({ length: 4 }, () => ({
      model: 'fixture CPU',
      speed: 1000,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    })),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
test('refuses missing Emscripten before deleting caches or spawning', async () => {
  vi.mocked(ensureEmscripten).mockResolvedValue({ available: false })
  await expect(compileWasm(config)).rejects.toThrow()
  expect(ensureEmscripten).toHaveBeenCalledExactlyOnceWith({
    autoInstall: false,
    quiet: true,
    version: '3.1.0',
  })
  expect(safeDelete).not.toHaveBeenCalled()
  expect(io.spawn).not.toHaveBeenCalled()
})
test.each([true, false])(
  'builds with explicit environment, parallelism and available tools, CI=%s',
  async isCI => {
    io.windows = isCI
    io.which.mockReturnValue(isCI ? undefined : '/example/tool')
    io.exists.mockImplementation(file =>
      isCI ? file === config.buildOutputPaths.buildWasmFile : true,
    )
    const result = await compileWasm({
      ...config,
      isCI,
      buildMode: isCI ? 'dev' : 'prod',
    })
    const { 0: command, 1: args, 2: options } = io.spawn.mock.calls[0]!
    expect(command).toBe(config.buildScriptFile)
    expect(args).toContain(isCI ? '4' : '3')
    expect(args.includes('Ninja')).toBe(!isCI)
    expect(args).toContain('--enable_wasm_threads')
    expect(args).toContain('--enable_wasm_simd')
    expect(options).toMatchObject({
      cwd: config.modeSourceDir,
      shell: isCI,
      stdio: 'inherit',
      env: {
        CFLAGS: expect.stringContaining('-ffile-prefix-map='),
        EMCC_CXXFLAGS: expect.stringContaining('-ffile-prefix-map='),
      },
    })
    if (!isCI) {
      expect(options.env).toMatchObject({
        CCACHE_MAXSIZE: '10G',
        CCACHE_COMPRESS: '1',
        CCACHE_COMPRESSLEVEL: '6',
      })
    }
    expect(safeDelete).toHaveBeenCalledTimes(isCI ? 0 : 2)
    expect(result).toMatchObject({
      artifactPath: '/example/build/Release',
      binaryPath: 'Release/onnx.wasm',
      binarySize: '1 KB',
    })
    await expect(result.smokeTest()).resolves.toBeUndefined()
    expect(io.spinner.stop).toHaveBeenCalledTimes(1)
  },
)
test('rejects missing output after a successful build', async () => {
  io.exists.mockReturnValue(false)
  await expect(compileWasm(config)).rejects.toThrow()
  expect(io.spinner.stop).toHaveBeenCalledTimes(1)
})
test.each(['bad-magic', 'no-exports', 'malformed-module'])(
  'rejects WASM artifact with %s',
  async defect => {
    vi.mocked(fs.readFile).mockResolvedValue(
      defect === 'bad-magic'
        ? Buffer.from('fixture invalid WASM')
        : Buffer.from(
            defect === 'no-exports' ? '0061736d01000000' : '0061736dffffffff',
            'hex',
          ),
    )
    const result = await compileWasm(config)
    await expect(result.smokeTest()).rejects.toThrow()
  },
)
test('updates progress during a build and clears its interval on completion', async () => {
  vi.useFakeTimers()
  const deferred = Promise.withResolvers<{
    code: number
    stdout: string
    stderr: string
    pid: number
  }>()
  io.spawn.mockReturnValue(deferred.promise)
  const running = compileWasm(config)
  await vi.advanceTimersByTimeAsync(5000)
  expect(io.spinner.text).toHaveBeenCalledTimes(1)
  deferred.resolve({ code: 0, stdout: '', stderr: '', pid: 0 })
  await running
  expect(vi.getTimerCount()).toBe(0)
})
test('stops progress and clears its interval when the real process contract rejects', async () => {
  vi.useFakeTimers()
  const failure = Object.assign(new Error('fixture build failure'), {
    code: 1,
    stdout: '',
    stderr: '',
  })
  io.spawn.mockRejectedValue(failure)
  await expect(compileWasm(config)).rejects.toBe(failure)
  expect(vi.getTimerCount()).toBe(0)
  expect(io.spinner.stop).toHaveBeenCalledTimes(1)
})
