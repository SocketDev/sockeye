import path from 'node:path'
import { expect, test, vi } from 'vitest'
import {
  BUILD_ROOT,
  getBuildOutputPaths,
  getBuildPaths,
  getCurrentPlatform,
  getSharedBuildPaths,
} from '../scripts/paths.mts'

vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  getCurrentPlatformArch: async () => 'linux-x64-musl',
}))
test.each(['darwin', 'linux'] as const)(
  '%s source output paths use the CMake platform leaf',
  platform => {
    const output = getBuildOutputPaths('/example/source', platform)
    expect(output.buildOutputDir).toBe(
      `/example/source/build/${platform === 'darwin' ? 'MacOS' : 'Linux'}/Release`,
    )
    expect(output.buildWasmFile).toBe(
      path.join(output.buildOutputDir, 'ort-wasm-simd-threaded.wasm'),
    )
    expect(output.buildMjsFile).toBe(
      path.join(output.buildOutputDir, 'ort-wasm-simd-threaded.mjs'),
    )
    expect(output.buildCmakeCacheFile).toBe(
      path.join(output.buildOutputDir, 'CMakeCache.txt'),
    )
    expect(output.buildPostBuildScriptFile).toBe(
      path.join(output.buildOutputDir, 'wasm_post_build.js'),
    )
  },
)
test('shared source inputs stay outside platform-specific Wasm outputs', () => {
  const shared = getSharedBuildPaths()
  expect(shared.buildDir).toBe(path.join(BUILD_ROOT, 'shared'))
  expect(shared.cmakeWebassemblyFile).toBe(
    path.join(shared.sourceDir, 'cmake', 'onnxruntime_webassembly.cmake'),
  )
  expect(shared.postBuildSourceFile).toBe(
    path.join(shared.sourceDir, 'js', 'web', 'script', 'wasm_post_build.js'),
  )
  const build = getBuildPaths('prod', 'linux-x64-musl')
  expect(build.wasmDir).toBe(
    path.join(BUILD_ROOT, 'prod', 'linux-x64-musl', 'wasm'),
  )
  expect(build.outputSyncCjsFile).toBe(
    path.join(build.outputFinalDir, 'ort-sync.cjs'),
  )
  expect(build.outputSyncMjsFile).toBe(
    path.join(build.outputFinalDir, 'ort-sync.mjs'),
  )
  expect(build.outputWasmFile).toBe(path.join(build.outputFinalDir, 'ort.wasm'))
  expect(() => getBuildPaths('prod', '')).toThrow(Error)
})
test('current platform preserves libc qualification', async () => {
  await expect(getCurrentPlatform()).resolves.toBe('linux-x64-musl')
})
