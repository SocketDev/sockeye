import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import {
  getAssetPlatformArch,
  getCurrentPlatformArch,
  getPlatformArch,
  getRequestedGlibcFloor,
  isMusl,
  parsePlatformArch,
  tarSupportsNoAbsoluteNames,
  tarSupportsOverwrite,
} from '../lib/platform-mappings.mts'
const originalPlatform = process.platform
const originalArch = process.arch
const host = vi.hoisted(() => ({ exists: vi.fn(), spawn: vi.fn() }))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: host.exists,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: host.spawn,
}))
beforeEach(() => {
  vi.resetAllMocks()
  host.exists.mockReturnValue(false)
  host.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  for (const name of ['PLATFORM_ARCH', 'LIBC', 'TARGET_ARCH', 'GLIBC_FLOOR']) {
    vi.stubEnv(name, undefined)
  }
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  Object.defineProperty(process, 'arch', { value: originalArch })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test('maps supported build and asset platforms and rejects invalid targets', () => {
  expect(getPlatformArch('linux', 'x64', 'musl')).toBe('linux-x64-musl')
  expect(getPlatformArch('darwin', 'arm64')).toBe('darwin-arm64')
  expect(getAssetPlatformArch('win32', 'ia32')).toBe('win32-x86')
  expect(getAssetPlatformArch('linux', 'x64', 'glibc')).toBe('linux-x64')
  expect(getAssetPlatformArch('linux', 'arm64', 'musl')).toBe(
    'linux-arm64-musl',
  )
  expect(getAssetPlatformArch('linux', 'x64')).toBe('linux-x64')
  for (const mapper of [getPlatformArch, getAssetPlatformArch]) {
    expect(() => mapper('linux', 'unknown')).toThrow(Error)
    expect(() => mapper('unknown', 'x64')).toThrow(Error)
    expect(() => mapper('linux', 'x64', 'unknown')).toThrow(Error)
    expect(() => mapper('darwin', 'arm64', 'musl')).toThrow(Error)
  }
})

test('parses explicit targets and rejects malformed platform, architecture and libc combinations', () => {
  expect(parsePlatformArch('linux-x64-musl')).toEqual({
    platform: 'linux',
    arch: 'x64',
    libc: 'musl',
  })
  expect(parsePlatformArch('win32-x86')).toEqual({
    platform: 'win32',
    arch: 'ia32',
    libc: undefined,
  })
  expect(parsePlatformArch('linux-arm64-glibc')).toEqual({
    platform: 'linux',
    arch: 'arm64',
    libc: 'glibc',
  })
  for (const target of [
    '',
    'linux',
    'linux-x64-musl-extra',
    'unknown-x64',
    'linux-unknown',
    'linux-x64-unknown',
    'darwin-arm64-musl',
  ]) {
    expect(() => parsePlatformArch(target)).toThrow(Error)
  }
})

test('detects musl only on Linux using Alpine metadata or ldd output', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  expect(await isMusl()).toBe(false)
  expect(host.exists).not.toHaveBeenCalled()
  Object.defineProperty(process, 'platform', { value: 'linux' })
  host.exists.mockReturnValue(true)
  expect(await isMusl()).toBe(true)
  expect(host.spawn).not.toHaveBeenCalled()
  host.exists.mockReturnValue(false)
  host.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: 'musl libc' })
  expect(await isMusl()).toBe(true)
  expect(host.spawn).toHaveBeenCalledWith('ldd', ['--version'], {
    stdio: 'pipe',
  })
  host.spawn.mockResolvedValue({ code: 0, stdout: 'GNU libc', stderr: '' })
  expect(await isMusl()).toBe(false)
  host.spawn.mockRejectedValue(
    Object.assign(new Error('missing executable'), { code: 'ENOENT' }),
  )
  expect(await isMusl()).toBe(false)
})

test('explicit targets bypass discovery while cross compilation honors architecture and libc', async () => {
  vi.stubEnv('PLATFORM_ARCH', 'linux-arm64-musl')
  expect(await getCurrentPlatformArch()).toBe('linux-arm64-musl')
  expect(host.spawn).not.toHaveBeenCalled()
  vi.stubEnv('PLATFORM_ARCH', undefined)
  Object.defineProperty(process, 'platform', { value: 'linux' })
  vi.stubEnv('TARGET_ARCH', 'arm64')
  vi.stubEnv('LIBC', 'glibc')
  expect(await getCurrentPlatformArch()).toBe('linux-arm64')
  vi.stubEnv('TARGET_ARCH', undefined)
  vi.stubEnv('LIBC', undefined)
  Object.defineProperty(process, 'arch', { value: 'x64' })
  host.exists.mockReturnValue(true)
  expect(await getCurrentPlatformArch()).toBe('linux-x64-musl')
  host.exists.mockReturnValue(false)
  expect(await getCurrentPlatformArch()).toBe('linux-x64')
})

test('accepts only supported trimmed glibc floors', () => {
  expect(getRequestedGlibcFloor()).toBeUndefined()
  for (const floor of ['2.17', '2.28']) {
    vi.stubEnv('GLIBC_FLOOR', ` ${floor} `)
    expect(getRequestedGlibcFloor()).toBe(floor)
  }
  vi.stubEnv('GLIBC_FLOOR', '2.99')
  expect(() => getRequestedGlibcFloor()).toThrow(Error)
})

test('tar probes require exact flags and tolerate unavailable executables', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  expect(await tarSupportsOverwrite()).toBe(false)
  expect(host.spawn).not.toHaveBeenCalled()
  Object.defineProperty(process, 'platform', { value: 'linux' })
  host.spawn.mockResolvedValue({
    code: 0,
    stdout: '  --overwrite replace files\n --no-absolute-names',
    stderr: '',
  })
  expect(await tarSupportsOverwrite()).toBe(true)
  expect(await tarSupportsNoAbsoluteNames()).toBe(true)
  host.spawn.mockResolvedValue({
    code: 0,
    stdout: '-k do not overwrite files',
    stderr: '',
  })
  expect(await tarSupportsOverwrite()).toBe(false)
  expect(await tarSupportsNoAbsoluteNames()).toBe(false)
  host.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  expect(await tarSupportsOverwrite()).toBe(false)
  expect(await tarSupportsNoAbsoluteNames()).toBe(false)
  host.spawn.mockRejectedValue(
    Object.assign(new Error('missing executable'), { code: 'ENOENT' }),
  )
  expect(await tarSupportsOverwrite()).toBe(false)
  expect(await tarSupportsNoAbsoluteNames()).toBe(false)
})
