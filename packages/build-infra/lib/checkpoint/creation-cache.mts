import { validateCheckpointBuildOptions } from './cache-validation.mts'
import crypto from 'node:crypto'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import {
  composeCheckpointMetadata,
  computeBuildCacheEnvMetadata,
} from '../checkpoint-cache-key.mts'
import { PLATFORM_AGNOSTIC_CHECKPOINTS } from '../constants.mts'
import { computeSourceHash } from '../extraction-cache.mts'
import type { CheckpointCreationOptions } from './create.mts'

const logger = getDefaultLogger()

export function computeCreationCacheHash(
  checkpointName: string,
  config: CheckpointCreationOptions,
): string | undefined {
  const data = { __proto__: null, ...config } as CheckpointCreationOptions
  let cacheHash: string | undefined
  if (data.sourcePaths && Array.isArray(data.sourcePaths)) {
    const isPlatformAgnostic = PLATFORM_AGNOSTIC_CHECKPOINTS.has(checkpointName)

    const platformMetadata =
      !isPlatformAgnostic && data.platform && data.arch
        ? `${data.platform}-${data.arch}${data.libc ? `-${data.libc}` : ''}`
        : undefined
    const versionMetadata = data.nodeVersion
      ? `node-${data.nodeVersion}`
      : undefined

    const envMetadata = computeBuildCacheEnvMetadata()

    validateCheckpointBuildOptions(data)
    const buildModeMetadata = data.buildMode
      ? `build-${data.buildMode}`
      : undefined
    const liefMetadata =
      data.withLief !== undefined ? `lief-${data.withLief}` : undefined
    const configureFlagsMetadata = data.configureFlags
      ? `config-${crypto.createHash('sha256').update(data.configureFlags).digest('hex').slice(0, 8)}`
      : undefined

    const fullMetadata = composeCheckpointMetadata({
      platform: platformMetadata,
      version: versionMetadata,
      env: envMetadata,
      buildMode: buildModeMetadata,
      lief: liefMetadata,
      configureFlags: configureFlagsMetadata,
    })

    if (!isPlatformAgnostic && !fullMetadata) {
      throw new Error(
        `Missing required metadata for platform-specific checkpoint: ${checkpointName}. ` +
          'Ensure platform/arch are provided.',
      )
    }

    cacheHash = computeSourceHash(data.sourcePaths, {
      platformMetadata: fullMetadata !== '' ? fullMetadata : platformMetadata,
    })
    logger.substep(`Cache key: ${cacheHash.substring(0, 12)}...`)
  }

  return cacheHash
}
