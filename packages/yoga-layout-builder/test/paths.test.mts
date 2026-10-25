import path from 'node:path'
import { expect, test, vi } from 'vitest'
import {
  BUILD_ROOT,
  getBindingsPaths,
  getBuildPaths,
  getCurrentPlatform,
  getSharedBuildPaths,
} from '../scripts/paths.mts'

vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  getCurrentPlatformArch: async () => 'linux-arm64-musl',
}))

test('binding sources come from the matching checked-out core', () => {
  const paths = getBindingsPaths('/example/yoga-source')
  expect(paths.bindingsFiles).toEqual(
    ['embind.cpp', 'Node.cpp', 'Config.cpp'].map(name =>
      path.join(paths.bindingsDir, name),
    ),
  )
  expect(paths.bindingsDir).toBe('/example/yoga-source/javascript/src')
})
test('pristine checkpoints are shared while Wasm outputs remain platform-specific', () => {
  const shared = getSharedBuildPaths()
  expect(shared.buildDir).toBe(path.join(BUILD_ROOT, 'shared'))
  expect(shared.checkpointsDir).toBe(path.join(shared.buildDir, 'checkpoints'))
  expect(shared.sourceDir).toBe(path.join(shared.buildDir, 'source'))
  const build = getBuildPaths('prod', 'linux-arm64-musl')
  expect(build.buildDir).toBe(path.join(BUILD_ROOT, 'prod', 'linux-arm64-musl'))
  expect(build.wasmDir).toBe(path.join(build.buildDir, 'wasm'))
  expect(build.outputWasmFile).toBe(
    path.join(build.outputFinalDir, 'yoga.wasm'),
  )
  expect(build.outputMjsFile).toBe(path.join(build.outputFinalDir, 'yoga.mjs'))
  expect(build.outputSyncCjsFile).toBe(
    path.join(build.outputFinalDir, 'yoga-sync.cjs'),
  )
  expect(build.outputSyncMjsFile).toBe(
    path.join(build.outputFinalDir, 'yoga-sync.mjs'),
  )
  expect(build.staticLibFile).toBe(
    path.join(build.cmakeDir, 'yoga', 'libyogacore.a'),
  )
  expect(build.cmakeListsFile).toBe(
    path.join(build.sourceDir, 'CMakeLists.txt'),
  )
  expect(() => getBuildPaths('dev', '')).toThrow(Error)
})
test('current platform delegates to the shared detector', async () => {
  await expect(getCurrentPlatform()).resolves.toBe('linux-arm64-musl')
})
