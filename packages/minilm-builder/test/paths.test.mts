import path from 'node:path'
import { expect, test, vi } from 'vitest'
import {
  BUILD_ROOT,
  getBuildPaths,
  getCurrentPlatform,
  getModelPaths,
} from '../scripts/paths.mts'

vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  getCurrentPlatformArch: async () => 'linux-x64-musl',
}))

test('model artifacts remain partitioned by build mode, platform and quantization', () => {
  const build = getBuildPaths('prod', 'linux-x64-musl', 'int4')
  expect(build.buildDir).toBe(
    path.join(BUILD_ROOT, 'prod', 'linux-x64-musl', 'int4'),
  )
  const model = getModelPaths('prod', 'linux-x64-musl', 'int4', 'example-model')
  expect(model).toEqual({
    cacheModelDir: path.join(build.cacheDir, 'example-model'),
    finalModelFile: path.join(build.modelsDir, 'example-model.onnx'),
    onnxModelDir: path.join(build.modelsDir, 'example-model-onnx'),
    onnxModelFile: path.join(
      build.modelsDir,
      'example-model-onnx',
      'model.onnx',
    ),
    optimizedModelDir: path.join(build.modelsDir, 'example-model-optimized'),
    optimizedModelFile: path.join(
      build.modelsDir,
      'example-model-optimized',
      'model.onnx',
    ),
    quantizedModelDir: path.join(build.modelsDir, 'example-model-quantized'),
    quantizedModelFile: path.join(
      build.modelsDir,
      'example-model-quantized',
      'model_quantized.onnx',
    ),
    tokenizerDir: path.join(build.modelsDir, 'example-model-tokenizer'),
  })
  expect(getBuildPaths('dev', 'linux-x64-musl', 'int8').buildDir).not.toBe(
    build.buildDir,
  )
  expect(() => getBuildPaths('dev', '', 'int8')).toThrow(Error)
})
test('current platform keeps libc qualification', async () => {
  await expect(getCurrentPlatform()).resolves.toBe('linux-x64-musl')
})
