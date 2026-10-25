import path from 'node:path'
import { expect, test, vi } from 'vitest'
import {
  BUILD_ROOT,
  getBuildPaths,
  getCurrentPlatform,
  MODELS_DIR,
} from '../scripts/paths.mts'

vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  getCurrentPlatformArch: async () => 'linux-arm64-musl',
}))
test('quantized artifacts are isolated while source model files remain shared', () => {
  const four = getBuildPaths('prod', 'linux-arm64-musl', 'int4')
  const eight = getBuildPaths('prod', 'linux-arm64-musl', 'int8')
  expect(four.buildDir).toBe(
    path.join(BUILD_ROOT, 'prod', 'linux-arm64-musl', 'int4'),
  )
  expect(four.encoderFile).not.toBe(eight.encoderFile)
  expect(four.decoderFile).not.toBe(eight.decoderFile)
  expect(four.tokenizerFile).toBe(eight.tokenizerFile)
  expect(four.configFile).toBe(path.join(MODELS_DIR, 'config.json'))
  expect(four.outputEncoderFile).toBe(path.join(four.outputDir, 'encoder.onnx'))
  expect(four.outputDecoderFile).toBe(path.join(four.outputDir, 'decoder.onnx'))
  expect(four.outputTokenizerFile).toBe(
    path.join(four.outputDir, 'tokenizer.json'),
  )
  expect(() => getBuildPaths('prod', '', 'int4')).toThrow(Error)
})
test('current platform preserves the shared detector result', async () => {
  await expect(getCurrentPlatform()).resolves.toBe('linux-arm64-musl')
})
