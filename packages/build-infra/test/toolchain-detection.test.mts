import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  checkBuildSourceFlag,
  checkPython,
  checkRust,
  commandExists,
  getBuildSourceFlags,
  getCommandOutput,
  isDocker,
  shouldBuildFromSource,
} from '../lib/build-env-toolchain.mts'
const io = vi.hoisted(() => ({
  platform: 'linux',
  exists: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(import('node:os'), async original => ({
  ...(await original()),
  default: { ...(await original()).default, platform: () => io.platform },
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/version-metadata.mts'), () => ({
  getMinPythonVersion: () => '3.12',
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.platform = 'linux'
  io.exists.mockReturnValue(false)
  for (const name of [
    'BUILD_ALL_FROM_SOURCE',
    'BUILD_TOOLS_FROM_SOURCE',
    'BUILD_DEPS_FROM_SOURCE',
  ]) {
    vi.stubEnv(name, undefined)
  }
})
afterEach(() => vi.unstubAllEnvs())

test.each([
  { version: '3.11.9', meets: false },
  { version: '3.12.1', meets: true },
  { version: '4.0.0', meets: true },
  { version: '2.7.0', meets: false },
])(
  'Python $version is checked against the minimum',
  async ({ version, meets }) => {
    io.spawn.mockImplementation(async command => ({
      code: 0,
      stdout: command === 'python3' ? `Python ${version}` : '/example/python3',
      stderr: '',
    }))
    expect(await checkPython()).toEqual({
      available: true,
      command: 'python3',
      meetsRequirement: meets,
      version,
    })
  },
)

test('Python discovery tries the fallback command after missing or unrecognized candidates', async () => {
  io.spawn.mockImplementation(async (command, args) => {
    if (command === 'which' && args[0] === 'python3') {
      throw Object.assign(new Error('fixture missing command'), { code: 1 })
    }
    return {
      code: 0,
      stdout: command === 'python' ? 'Python 3.12.4' : '/example/python',
      stderr: '',
    }
  })
  expect(await checkPython()).toEqual({
    available: true,
    command: 'python',
    meetsRequirement: true,
    version: '3.12.4',
  })
  io.spawn.mockResolvedValue({
    code: 0,
    stdout: 'unrecognized compiler',
    stderr: '',
  })
  expect(await checkPython()).toEqual({ available: false })
})

test('Rust discovery reports the first missing prerequisite', async () => {
  io.spawn.mockRejectedValue(
    Object.assign(new Error('fixture missing rustc'), { code: 1 }),
  )
  expect(await checkRust()).toEqual({
    available: false,
    reason: 'rustc not found',
  })
  io.spawn.mockResolvedValue({
    code: 0,
    stdout: 'unexpected version output',
    stderr: '',
  })
  expect(await checkRust()).toEqual({
    available: false,
    reason: 'version detection failed',
  })
  io.spawn.mockImplementation(async command => ({
    code: 0,
    stdout: command === 'rustc' ? 'rustc 1.90.0' : '',
    stderr: '',
  }))
  expect(await checkRust()).toEqual({
    available: false,
    reason: 'wasm32-unknown-unknown target not installed',
    fix: 'rustup target add wasm32-unknown-unknown',
  })
  io.spawn.mockImplementation(async (command, args) => {
    if (command === 'which' && args[0] === 'wasm-pack') {
      throw Object.assign(new Error('fixture missing wasm-pack'), { code: 1 })
    }
    return {
      code: 0,
      stdout: command === 'rustc' ? 'rustc 1.90.0' : 'wasm32-unknown-unknown',
      stderr: '',
    }
  })
  expect(await checkRust()).toEqual({
    available: false,
    reason: 'wasm-pack not found',
    fix: 'cargo install wasm-pack',
  })
  io.spawn.mockImplementation(async command => ({
    code: 0,
    stdout: command === 'rustc' ? 'rustc 1.90.0' : 'wasm32-unknown-unknown',
    stderr: '',
  }))
  expect(await checkRust()).toEqual({ available: true, version: '1.90.0' })
})

test('Windows command discovery uses where and output capture trims stdout', async () => {
  io.platform = 'win32'
  io.spawn.mockResolvedValue({
    code: 0,
    stdout: ' example output \n',
    stderr: '',
  })
  expect(await commandExists('example-tool')).toBe(true)
  expect(io.spawn).toHaveBeenCalledWith('where', ['example-tool'], {
    stdio: 'pipe',
  })
  expect(await getCommandOutput('example-tool')).toBe('example output')
  io.spawn.mockRejectedValue(
    Object.assign(new Error('fixture launch failure'), { code: 'ENOENT' }),
  )
  expect(await getCommandOutput('example-tool')).toBe('')
})

test('container detection accepts Docker or Podman marker files', () => {
  expect(isDocker()).toBe(false)
  io.exists.mockReturnValueOnce(true)
  expect(isDocker()).toBe(true)
  io.exists.mockReturnValueOnce(false).mockReturnValueOnce(true)
  expect(isDocker()).toBe(true)
})

test('source-build flags preserve independent choices and the global override', () => {
  expect(getBuildSourceFlags()).toEqual({
    buildAllFromSource: false,
    buildDepsFromSource: false,
    buildToolsFromSource: false,
  })
  expect(shouldBuildFromSource('ALL')).toBe(false)
  expect(checkBuildSourceFlag('example-tool', 'TOOLS')).toBeUndefined()
  vi.stubEnv('BUILD_TOOLS_FROM_SOURCE', 'true')
  expect(shouldBuildFromSource('TOOLS')).toBe(true)
  expect(() => checkBuildSourceFlag('example-tool', 'TOOLS')).toThrow(Error)
  expect(() =>
    checkBuildSourceFlag('example-tool', 'TOOLS', {
      buildCommand: 'pnpm run example-build',
    }),
  ).toThrow(Error)
  vi.stubEnv('BUILD_DEPS_FROM_SOURCE', 'true')
  expect(getBuildSourceFlags()).toEqual({
    buildAllFromSource: false,
    buildDepsFromSource: true,
    buildToolsFromSource: true,
  })
  vi.stubEnv('BUILD_ALL_FROM_SOURCE', 'true')
  expect(shouldBuildFromSource('ALL')).toBe(true)
  expect(getBuildSourceFlags()).toEqual({
    buildAllFromSource: true,
    buildDepsFromSource: true,
    buildToolsFromSource: true,
  })
})
