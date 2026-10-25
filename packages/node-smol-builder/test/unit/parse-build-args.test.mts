import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  calculateCpuCount,
  parseBuildArgs,
  parseSmolDropArg,
} from '../../scripts/common/shared/parse-build-args.mts'

const io = vi.hoisted(() => ({
  memory: 32 * 1024 ** 3,
  cpus: 8,
  warn: vi.fn(),
}))
vi.mock(import('node:os'), () => ({
  default: {
    homedir: () => '/example/home',
    cpus: () => Array.from({ length: io.cpus }),
    totalmem: () => io.memory,
  },
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ warn: io.warn }),
}))
const savedArguments = process.argv
beforeEach(() => {
  vi.clearAllMocks()
  io.cpus = 8
  io.memory = 32 * 1024 ** 3
  for (const key of [
    'BUILD_JOBS',
    'CI',
    'CONTINUOUS_INTEGRATION',
    'BUILD_WITH_LIEF',
    'BUILD_WITH_DAWN',
  ]) {
    vi.stubEnv(key, undefined)
  }
  process.argv = ['node', '/example/build.mts']
})
afterEach(() => {
  process.argv = savedArguments
  vi.unstubAllEnvs()
})

test('adaptive parallelism respects both memory and CPU capacity with a one-job floor', () => {
  expect(calculateCpuCount()).toBe(8)
  io.memory = 9 * 1024 ** 3
  expect(calculateCpuCount()).toBe(2)
  io.memory = 0
  expect(calculateCpuCount()).toBe(1)
  vi.stubEnv('BUILD_JOBS', '12')
  expect(calculateCpuCount()).toBe(12)
  vi.stubEnv('BUILD_JOBS', ' +012 ')
  expect(calculateCpuCount()).toBe(12)
})
test.each(['0', '-2', 'invalid', '2jobs', '1.5', '9007199254740992'])(
  'rejects invalid explicit parallelism %s',
  value => {
    vi.stubEnv('BUILD_JOBS', value)
    expect(() => calculateCpuCount()).toThrow(Error)
  },
)
test('feature drops retain explicit flags and omit unknown names', () => {
  expect(parseSmolDropArg('quic, --without-example, ,example-unknown')).toEqual(
    ['--without-smol-quic', '--without-example'],
  )
  expect(io.warn).toHaveBeenCalledOnce()
  expect(parseSmolDropArg(undefined)).toEqual([])
  expect(parseSmolDropArg(true)).toEqual([])
})
test('defaults remain local development with detected target values', () => {
  const config = parseBuildArgs()
  expect(config.BUILD_MODE).toBe('dev')
  expect(config.TARGET_PLATFORM).toBe(process.platform)
  expect(config.TARGET_ARCH).toBe(process.arch)
  expect(config.WITH_DAWN).toBe(false)
  expect(config.WITH_LIEF).toBe(false)
})
test('explicit target and feature flags produce the build contract', () => {
  process.argv.push(
    '--prod',
    '--platform',
    'linux',
    '--arch',
    'arm64',
    '--libc',
    'musl',
    '--clean',
    '--yes',
    '--with-dawn',
    '--with-lief',
    '--without-smol',
    'quic',
  )
  const config = parseBuildArgs()
  expect(config).toMatchObject({
    BUILD_MODE: 'prod',
    TARGET_PLATFORM: 'linux',
    TARGET_ARCH: 'arm64',
    TARGET_LIBC: 'musl',
    CLEAN_BUILD: true,
    AUTO_YES: true,
    WITH_DAWN: true,
    WITH_LIEF: true,
    EXTRA_CONFIGURE_FLAGS: ['--without-smol-quic'],
  })
  expect(process.env['BUILD_WITH_DAWN']).toBe('true')
  expect(process.env['BUILD_WITH_LIEF']).toBe('true')
})
test('CI defaults to production while an explicit development flag wins', () => {
  vi.stubEnv('CI', 'true')
  expect(parseBuildArgs().BUILD_MODE).toBe('prod')
  process.argv.push('--dev')
  expect(parseBuildArgs().BUILD_MODE).toBe('dev')
})
test.each([
  ['--libc', 'invalid'],
  ['--platform', 'darwin', '--libc', 'musl'],
  ['--from-checkpoint', 'invalid'],
  ['--stop-at', 'invalid'],
  ['--build-only', 'invalid'],
  ['--build-only', 'finalized', '--stop-at', 'finalized'],
  ['--build-only', 'finalized', '--from-checkpoint', 'binary-released'],
])('rejects incompatible options %j', (...args) => {
  process.argv.push(...args)
  expect(() => parseBuildArgs()).toThrow(Error)
})
test('valid checkpoint range survives parsing', () => {
  process.argv.push(
    '--from-checkpoint',
    'binary-released',
    '--stop-at',
    'finalized',
  )
  expect(parseBuildArgs()).toMatchObject({
    FROM_CHECKPOINT: 'binary-released',
    STOP_AT: 'finalized',
    BUILD_ONLY: undefined,
  })
})
