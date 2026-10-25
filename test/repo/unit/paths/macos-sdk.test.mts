import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  getCmakeSdkConfigureArgs,
  isCmakeSdkCacheCurrent,
  resolveMacosSdkPath,
} from '../../../../scripts/repo/paths/macos-sdk.mts'

const io = vi.hoisted(() => ({
  readFile: vi.fn(),
  spawn: vi.fn(),
  stat: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))

vi.mock(import('node:fs/promises'), async original => ({
  ...(await original()),
  readFile: io.readFile,
  stat: io.stat,
}))

beforeEach(() => {
  vi.resetAllMocks()
  io.spawn.mockResolvedValue({ code: 0, stdout: '/example/MacOSX.sdk\n' })
  io.stat.mockResolvedValue({ isDirectory: () => true })
})

afterEach(() => vi.restoreAllMocks())

test('resolves the installed macOS SDK path through xcrun', async () => {
  expect(await resolveMacosSdkPath()).toBe('/example/MacOSX.sdk')
  expect(io.spawn).toHaveBeenCalledWith(
    'xcrun',
    ['--sdk', 'macosx', '--show-sdk-path'],
    expect.any(Object),
  )
  expect(io.stat).toHaveBeenCalledExactlyOnceWith('/example/MacOSX.sdk')
})

test.each(['', 'relative-sdk'])('rejects invalid SDK output %j', async sdk => {
  io.spawn.mockResolvedValue({ code: 0, stdout: sdk })
  await expect(resolveMacosSdkPath()).rejects.toThrow()
  expect(io.stat).not.toHaveBeenCalled()
})

test('rejects an unsuccessful SDK lookup', async () => {
  io.spawn.mockResolvedValue({ code: 1, stdout: '/example/MacOSX.sdk' })
  await expect(resolveMacosSdkPath()).rejects.toThrow(/exit 1/u)
  expect(io.stat).not.toHaveBeenCalled()
})

test('rejects a path that is not an SDK directory', async () => {
  io.stat.mockResolvedValue({ isDirectory: () => false })
  await expect(resolveMacosSdkPath()).rejects.toThrow()
})

test('propagates xcrun launch failures', async () => {
  const failure = Object.assign(new Error('fixture xcrun missing'), {
    code: 'ENOENT',
  })
  io.spawn.mockRejectedValue(failure)
  await expect(resolveMacosSdkPath()).rejects.toBe(failure)
})

test('keeps CMake cache when its SDK and framework paths are current', () => {
  const sdk = '/example/MacOSX27.0.sdk'
  const cache = [
    `CMAKE_OSX_SYSROOT:PATH=${sdk}`,
    `FOUNDATION_FRAMEWORK:FILEPATH=${sdk}/System/Library/Frameworks/Foundation.framework`,
  ].join('\n')
  expect(isCmakeSdkCacheCurrent(cache, sdk)).toBe(true)
})

test('refreshes CMake cache when a framework path points to an older SDK', () => {
  const sdk = '/example/MacOSX27.0.sdk'
  const cache = [
    `CMAKE_OSX_SYSROOT:PATH=${sdk}`,
    'FOUNDATION_FRAMEWORK:FILEPATH=/example/MacOSX26.5.sdk/System/Library/Frameworks/Foundation.framework',
  ].join('\n')
  expect(isCmakeSdkCacheCurrent(cache, sdk)).toBe(false)
})

test('refreshes CMake cache when the selected SDK changes', () => {
  expect(
    isCmakeSdkCacheCurrent(
      'CMAKE_OSX_SYSROOT:PATH=/example/MacOSX26.5.sdk',
      '/example/MacOSX27.0.sdk',
    ),
  ).toBe(false)
})

test('clears CMake cache only when the configured SDK is stale', async () => {
  const cache = [
    'CMAKE_OSX_SYSROOT:PATH=/example/MacOSX27.0.sdk',
    'FOUNDATION_FRAMEWORK:FILEPATH=/example/MacOSX26.5.sdk/System/Library/Frameworks/Foundation.framework',
  ].join('\n')
  io.readFile.mockResolvedValue(cache)
  await expect(
    getCmakeSdkConfigureArgs('/example/build', '/example/MacOSX27.0.sdk'),
  ).resolves.toEqual(['--fresh'])
  expect(io.readFile).toHaveBeenCalledExactlyOnceWith(
    '/example/build/CMakeCache.txt',
    'utf8',
  )
})
