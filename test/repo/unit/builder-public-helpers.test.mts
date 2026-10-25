import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import {
  getCodet5LocalBuildDir,
  getCurrentCodet5PlatformArch,
} from '../../../packages/codet5-models-builder/lib/ensure-codet5.mts'
import {
  getCurlLocalBuildDir,
  getCurrentCurlPlatformArch,
} from '../../../packages/curl-builder/lib/ensure-curl.mts'
import {
  getDawnLocalBuildDir,
  getCurrentDawnPlatformArch,
} from '../../../packages/dawn-builder/lib/ensure-dawn.mts'
import {
  getMinilmLocalBuildDir,
  getCurrentMinilmPlatformArch,
} from '../../../packages/minilm-builder/lib/ensure-minilm.mts'
import {
  getOnnxruntimeLocalBuildDir,
  getCurrentOnnxruntimePlatformArch,
} from '../../../packages/onnxruntime-builder/lib/ensure-onnxruntime.mts'
import {
  getYogaLocalBuildDir,
  getCurrentYogaPlatformArch,
} from '../../../packages/yoga-layout-builder/lib/ensure-yoga.mts'
import {
  getCurlDownloadPaths,
  getCurlExtractPaths,
  getCurlLibraryPath,
} from '../../../packages/curl-builder/scripts/paths.mts'
import {
  getBuildPaths,
  getDawnBuiltLibraryPath,
  getDawnHeaderPaths,
} from '../../../packages/dawn-builder/scripts/paths.mts'
const host = vi.hoisted(() => ({ libc: vi.fn() }))
vi.mock(
  import('@socketsecurity/lib-stable/releases/socket-btm'),
  async original => ({ ...(await original()), detectLibc: host.libc }),
)
const originalPlatform = process.platform
const originalArch = process.arch
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('TARGET_ARCH', undefined)
  vi.stubEnv('BUILD_MODE', 'prod')
  Object.defineProperty(process, 'platform', { value: 'linux' })
  Object.defineProperty(process, 'arch', { value: 'x64' })
  host.libc.mockReturnValue('glibc')
})
afterEach(() => {
  vi.unstubAllEnvs()
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  Object.defineProperty(process, 'arch', { value: originalArch })
})

test.each([
  getCurrentCodet5PlatformArch,
  getCurrentCurlPlatformArch,
  getCurrentDawnPlatformArch,
  getCurrentMinilmPlatformArch,
  getCurrentOnnxruntimePlatformArch,
  getCurrentYogaPlatformArch,
])(
  'builder target helper %s honors explicit architecture and libc',
  getTarget => {
    expect(getTarget()).toBe('linux-x64')
    vi.stubEnv('TARGET_ARCH', 'arm64')
    host.libc.mockReturnValue('musl')
    expect(getTarget()).toBe('linux-arm64-musl')
  },
)

test.each([
  getCodet5LocalBuildDir,
  getCurlLocalBuildDir,
  getDawnLocalBuildDir,
  getMinilmLocalBuildDir,
  getOnnxruntimeLocalBuildDir,
  getYogaLocalBuildDir,
])('builder artifact helper %s keeps targets isolated', getDirectory => {
  const native = normalizePath(getDirectory('linux-x64'))
  const cross = normalizePath(getDirectory('linux-arm64-musl'))
  expect(native.split('/')).toContain('prod')
  expect(native.split('/')).toContain('linux-x64')
  expect(cross.split('/')).toContain('linux-arm64-musl')
  expect(native).not.toBe(cross)
})

test('curl paths separate cached downloads, extracted inputs and selected libraries', () => {
  const download = getCurlDownloadPaths('linux-arm64-musl')
  expect(normalizePath(download.targetDir).split('/').slice(-4)).toEqual([
    'build',
    'downloaded',
    'curl',
    'linux-arm64-musl',
  ])
  expect(download.versionFile).toBe(`${download.targetDir}/.version`)
  expect(getCurlExtractPaths('/example/archive')).toEqual({
    include: '/example/archive/include',
    lib: '/example/archive/lib',
    bin: '/example/archive/bin',
  })
  expect(
    getCurlLibraryPath({ directory: '/example/lib', filename: 'libcurl.a' }),
  ).toBe('/example/lib/libcurl.a')
})

test('Dawn paths identify built libraries and copied public header trees', () => {
  const paths = getBuildPaths('dev', 'linux-x64')
  expect(normalizePath(paths.cmakeDir).split('/').slice(-4)).toEqual([
    'build',
    'dev',
    'linux-x64',
    'cmake',
  ])
  expect(paths.outputLibFile).toBe(`${paths.outputDir}/lib/libwebgpu_dawn.a`)
  expect(paths.outputIncludeDir).toBe(`${paths.outputDir}/include`)
  expect(getDawnBuiltLibraryPath('/example/cmake')).toBe(
    '/example/cmake/src/dawn/native/libwebgpu_dawn.a',
  )
  expect(
    getDawnHeaderPaths('/example/include').map(entry => entry.dst),
  ).toEqual(['/example/include/dawn', '/example/include/webgpu'])
})
