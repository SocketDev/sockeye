/**
 * @file MiniLM build phase workers — download, convert, quantize, optimize,
 *   verify, export. Split out of build.mts (the orchestrator) to keep that
 *   file under the fleet's file-size cap; each phase takes the shared build
 *   context (`ctx`) computed once by `build.mts`'s `initBuildContext()`.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getFileSize } from 'local-build-infra/lib/build-helpers'
import {
  createCheckpoint,
  shouldRun,
} from 'local-build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'local-build-infra/lib/constants'

import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getModelPaths } from './paths.mts'
import { runPythonScript } from './python-script.mts'

const logger = getDefaultLogger()

/**
 * Download models from Hugging Face.
 */
export async function downloadModels(ctx) {
  const {
    buildDir,
    buildMode,
    cacheDir,
    forceBuild,
    models,
    platformArch,
    quantLevel,
    targetArch,
    targetPlatform,
  } = ctx
  if (
    !(await shouldRun(buildDir, 'minilm', CHECKPOINTS.DOWNLOADED, {
      force: forceBuild,
    }))
  ) {
    return
  }

  logger.step('Downloading Models from Hugging Face')

  await safeMkdir(cacheDir)

  for (let i = 0, { length } = models; i < length; i += 1) {
    const model = models[i]
    logger.substep(`Model: ${model.name}`)

    try {
      const { cacheModelDir } = getModelPaths(
        buildMode,
        platformArch,
        quantLevel,
        model.outputName,
      )
      await runPythonScript('download.py', [model.name, cacheModelDir])
      logger.success(`Downloaded: ${model.name}`)
    } catch (e) {
      if (errorMessage(e).includes('transformers not installed')) {
        logger.warn('Python transformers library not installed')
        logger.warn('Install with: pip install transformers')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  logger.success('Model download complete')
  await createCheckpoint(
    buildDir,
    CHECKPOINTS.DOWNLOADED,
    async () => {
      // Smoke test: Verify model cache directory exists
      if (!existsSync(cacheDir)) {
        throw new Error('Model cache directory not found')
      }
      logger.substep('Model cache validated')
    },
    { arch: targetArch, platform: targetPlatform },
  )
}

/**
 * Convert models to ONNX format.
 */
export async function convertToOnnx(ctx) {
  const {
    buildDir,
    buildMode,
    forceBuild,
    modelsDir,
    models,
    platformArch,
    quantLevel,
    targetArch,
    targetPlatform,
  } = ctx
  if (
    !(await shouldRun(buildDir, 'minilm', CHECKPOINTS.CONVERTED, {
      force: forceBuild,
    }))
  ) {
    return
  }

  logger.step('Converting Models to ONNX')

  await safeMkdir(modelsDir)

  for (let i = 0, { length } = models; i < length; i += 1) {
    const model = models[i]
    logger.substep(`Converting: ${model.name}`)
    const { cacheModelDir, onnxModelDir } = getModelPaths(
      buildMode,
      platformArch,
      quantLevel,
      model.outputName,
    )

    await runPythonScript('convert.py', [cacheModelDir, onnxModelDir])
    logger.success(`Converted: ${model.name}`)
  }

  logger.success('ONNX conversion complete')
  await createCheckpoint(
    buildDir,
    CHECKPOINTS.CONVERTED,
    async () => {
      // Smoke test: Verify ONNX models exist
      for (let i = 0, { length } = models; i < length; i += 1) {
        const model = models[i]
        const { onnxModelFile } = getModelPaths(
          buildMode,
          platformArch,
          quantLevel,
          model.outputName,
        )
        if (!existsSync(onnxModelFile)) {
          throw new Error(`Converted model not found: ${onnxModelFile}`)
        }
      }
      logger.substep('Converted ONNX models validated')
    },
    { arch: targetArch, platform: targetPlatform },
  )
}

/**
 * Optimize ONNX graphs.
 */
export async function optimizeGraphs(ctx) {
  const {
    buildDir,
    buildMode,
    forceBuild,
    models,
    platformArch,
    quantLevel,
    targetArch,
    targetPlatform,
  } = ctx
  if (
    !(await shouldRun(buildDir, 'minilm', CHECKPOINTS.OPTIMIZED, {
      force: forceBuild,
    }))
  ) {
    return
  }

  logger.step('Optimizing ONNX Graphs')

  for (let i = 0, { length } = models; i < length; i += 1) {
    const model = models[i]
    logger.substep(`Optimizing: ${model.outputName}`)

    try {
      const { onnxModelFile, optimizedModelFile } = getModelPaths(
        buildMode,
        platformArch,
        quantLevel,
        model.outputName,
      )

      const sizeBefore = await getFileSize(onnxModelFile)
      logger.substep(`Size before: ${sizeBefore}`)

      await runPythonScript('optimize.py', [
        onnxModelFile,
        optimizedModelFile,
        String(model.numHeads),
        String(model.hiddenSize),
      ])

      const sizeAfter = await getFileSize(optimizedModelFile)
      logger.substep(`Size after: ${sizeAfter}`)

      logger.success(`Optimized: ${model.outputName}`)
    } catch (e) {
      if (errorMessage(e).includes('onnxruntime not installed')) {
        logger.warn('Python onnxruntime library not installed')
        logger.warn('Install with: pip install onnxruntime')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  logger.success('Graph optimization complete')
  await createCheckpoint(
    buildDir,
    CHECKPOINTS.OPTIMIZED,
    async () => {
      // Smoke test: Verify optimized models exist
      for (let i = 0, { length } = models; i < length; i += 1) {
        const model = models[i]
        const { optimizedModelFile } = getModelPaths(
          buildMode,
          platformArch,
          quantLevel,
          model.outputName,
        )
        if (!existsSync(optimizedModelFile)) {
          throw new Error(`Optimized model not found: ${optimizedModelFile}`)
        }
      }
      logger.substep('Optimized models validated')
    },
    { arch: targetArch, platform: targetPlatform },
  )
}

/**
 * Apply mixed-precision quantization.
 */
export async function quantizeModels(ctx) {
  const {
    buildDir,
    buildMode,
    forceBuild,
    models,
    platformArch,
    quantLevel,
    targetArch,
    targetPlatform,
  } = ctx
  if (
    !(await shouldRun(buildDir, 'minilm', CHECKPOINTS.QUANTIZED, {
      force: forceBuild,
    }))
  ) {
    return
  }

  logger.step('Applying INT8 Quantization')

  for (let i = 0, { length } = models; i < length; i += 1) {
    const model = models[i]
    logger.substep(`Quantizing: ${model.outputName}`)
    const {
      optimizedModelDir,
      optimizedModelFile,
      quantizedModelDir,
      quantizedModelFile,
    } = getModelPaths(buildMode, platformArch, quantLevel, model.outputName)

    const sizeBefore = await getFileSize(optimizedModelFile)
    logger.substep(`Size before: ${sizeBefore}`)

    await runPythonScript('quantize.py', [optimizedModelDir, quantizedModelDir])

    const sizeAfter = await getFileSize(quantizedModelFile)
    logger.substep(`Size after: ${sizeAfter}`)

    logger.success(`Quantized: ${model.outputName}`)
  }

  logger.success('Quantization complete')
  await createCheckpoint(
    buildDir,
    CHECKPOINTS.QUANTIZED,
    async () => {
      // Smoke test: Verify quantized models exist
      for (let i = 0, { length } = models; i < length; i += 1) {
        const model = models[i]
        const { quantizedModelFile } = getModelPaths(
          buildMode,
          platformArch,
          quantLevel,
          model.outputName,
        )
        if (!existsSync(quantizedModelFile)) {
          throw new Error(`Quantized model not found: ${quantizedModelFile}`)
        }
      }
      logger.substep('Quantized models validated')
    },
    { arch: targetArch, platform: targetPlatform },
  )
}

/**
 * Verify models work correctly.
 */
export async function verifyModels(ctx) {
  const {
    buildDir,
    buildMode,
    forceBuild,
    models,
    platformArch,
    quantLevel,
    targetArch,
    targetPlatform,
  } = ctx
  if (
    !(await shouldRun(buildDir, 'minilm', CHECKPOINTS.FINALIZED, {
      force: forceBuild,
    }))
  ) {
    return
  }

  logger.step('Verifying Model Inference')

  for (let i = 0, { length } = models; i < length; i += 1) {
    const model = models[i]
    logger.substep(`Verifying: ${model.outputName}`)

    try {
      const { quantizedModelDir, quantizedModelFile } = getModelPaths(
        buildMode,
        platformArch,
        quantLevel,
        model.outputName,
      )
      const testText = 'This is a test'

      const result = await runPythonScript('verify.py', [
        quantizedModelFile,
        quantizedModelDir,
        testText,
      ])

      logger.substep(`Test: "${result.test_text}"`)
      logger.substep(`Output shape: [${result.output_shape.join(', ')}]`)
      logger.substep(
        `Mean: ${result.output_mean.toFixed(4)}, Std: ${result.output_std.toFixed(4)}`,
      )

      logger.success(`Verified: ${model.outputName}`)
    } catch (e) {
      if (errorMessage(e).includes('not installed')) {
        logger.warn('Missing Python dependencies')
        logger.warn('Install with: pip install onnxruntime transformers')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  logger.success('Model verification complete')
  await createCheckpoint(
    buildDir,
    CHECKPOINTS.FINALIZED,
    async () => {
      // Smoke test: Verify quantized models exist
      for (let i = 0, { length } = models; i < length; i += 1) {
        const model = models[i]
        const { quantizedModelFile } = getModelPaths(
          buildMode,
          platformArch,
          quantLevel,
          model.outputName,
        )
        if (!existsSync(quantizedModelFile)) {
          throw new Error(`Verified model not found: ${quantizedModelFile}`)
        }
      }
      logger.substep('Verified models validated')
    },
    { arch: targetArch, platform: targetPlatform },
  )
}

/**
 * Export models to distribution location.
 */
export async function exportModels(ctx) {
  const { buildMode, models, platformArch, quantLevel } = ctx

  logger.step('Exporting Models')

  for (let i = 0, { length } = models; i < length; i += 1) {
    const model = models[i]
    logger.substep(`Exporting: ${model.outputName}`)

    const {
      finalModelFile,
      quantizedModelDir,
      quantizedModelFile,
      tokenizerDir,
    } = getModelPaths(buildMode, platformArch, quantLevel, model.outputName)

    // Check if quantized model exists.
    if (!existsSync(quantizedModelFile)) {
      logger.warn(`Model not found: ${quantizedModelFile}`)
      logger.warn('Run build to generate models')
      continue
    }

    // Copy quantized model to final location.
    await fs.copyFile(quantizedModelFile, finalModelFile)

    // Copy tokenizer files.
    await safeMkdir(tokenizerDir)

    const tokenizerFiles = [
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'vocab.txt',
    ]
    for (
      let j = 0, { length: fileCount } = tokenizerFiles;
      j < fileCount;
      j += 1
    ) {
      const file = tokenizerFiles[j]
      const src = path.join(quantizedModelDir, file)
      const dst = path.join(tokenizerDir, file)

      if (existsSync(src)) {
        await fs.copyFile(src, dst)
      }
    }

    const modelSize = await getFileSize(finalModelFile)
    logger.substep(`Model: ${modelSize}`)
    logger.substep(`Location: ${finalModelFile}`)
  }

  logger.success('Export complete')
}
