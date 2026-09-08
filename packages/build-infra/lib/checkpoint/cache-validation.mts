import crypto from 'node:crypto'
import {
  composeCheckpointMetadata,
  computeBuildCacheEnvMetadata,
} from '../checkpoint-cache-key.mts'
import { computeSourceHash } from '../extraction-cache.mts'

export interface CheckpointBuildOptions {
  readonly arch?: string | undefined
  readonly buildMode?: string | undefined
  readonly configureFlags?: string | undefined
  readonly libc?: string | undefined
  readonly nodeVersion?: string | undefined
  readonly platform?: string | undefined
  readonly withLief?: boolean | undefined
}

export function computeBinaryCheckpointHash(
  checkpointName: string,
  sourcePaths: string[],
  config: CheckpointBuildOptions,
): string {
  const options = { __proto__: null, ...config } as CheckpointBuildOptions
  // Binary checkpoints: platform/arch MUST be passed explicitly. Falling
  // back to process.platform/arch under cross-compilation (e.g. building
  // Linux from a macOS host) tags the cache key with the host rather
  // than the target — a later same-target run then reads that polluted
  // entry and restores a binary labeled for the wrong platform.
  if (!options.platform || !options.arch) {
    throw new Error(
      `Checkpoint '${checkpointName}' shouldRun() requires explicit target {platform, arch} for binary stages. ` +
        `Got platform=${options.platform ?? 'undefined'}, arch=${options.arch ?? 'undefined'}. ` +
        'The host-platform fallback was removed because cross-compilation silently mis-tags cache entries.',
    )
  }
  const targetPlatform = options.platform
  const targetArch = options.arch
  const targetLibc = options.libc || undefined

  // For Linux binary checkpoints, libc MUST be specified
  if (targetPlatform === 'linux' && !targetLibc) {
    throw new Error(
      `Checkpoint '${checkpointName}' validation failed: ` +
        'libc parameter is required for Linux binary checkpoints. ' +
        'Specify options.libc = "glibc" or "musl" when calling shouldRun(). ' +
        'This prevents cross-libc checkpoint pollution (glibc binaries used for musl builds).',
    )
  }

  const platformMetadata = `${targetPlatform}-${targetArch}${targetLibc ? `-${targetLibc}` : ''}`
  const versionMetadata = options.nodeVersion
    ? `node-${options.nodeVersion}`
    : undefined

  // Include build-affecting env vars in cache key. Shared with
  // the write side via computeBuildCacheEnvMetadata so the two
  // can't drift.
  const envMetadata = computeBuildCacheEnvMetadata()

  validateCheckpointBuildOptions(options)
  const buildModeMetadata = options.buildMode
    ? `build-${options.buildMode}`
    : undefined
  const liefMetadata =
    options.withLief !== undefined ? `lief-${options.withLief}` : undefined
  const configureFlagsMetadata = options.configureFlags
    ? `config-${crypto.createHash('sha256').update(options.configureFlags).digest('hex').slice(0, 8)}`
    : undefined

  const fullMetadata = composeCheckpointMetadata({
    platform: platformMetadata,
    version: versionMetadata,
    env: envMetadata,
    buildMode: buildModeMetadata,
    lief: liefMetadata,
    configureFlags: configureFlagsMetadata,
  })
  return computeSourceHash(sourcePaths, fullMetadata || platformMetadata)
}

export function validateCheckpointBuildOptions(
  config: CheckpointBuildOptions,
): void {
  const options = { __proto__: null, ...config } as CheckpointBuildOptions
  // Include build configuration that affects binary output (must match createCheckpoint logic)
  // Validate buildMode to prevent cache poisoning
  if (options.buildMode) {
    const validBuildModes = ['dev', 'prod', 'int4', 'int8']
    if (!validBuildModes.includes(options.buildMode)) {
      throw new Error(
        `Invalid buildMode: "${options.buildMode}". ` +
          `Must be one of: ${validBuildModes.join(', ')}`,
      )
    }
  }
  // Validate withLief to prevent cache poisoning
  if (options.withLief !== undefined && typeof options.withLief !== 'boolean') {
    throw new Error(
      `Invalid withLief: expected boolean, got ${typeof options.withLief}`,
    )
  }
  // Validate configureFlags to prevent cache poisoning
  if (
    options.configureFlags !== undefined &&
    typeof options.configureFlags !== 'string'
  ) {
    throw new Error(
      `Invalid configureFlags: expected string, got ${typeof options.configureFlags}`,
    )
  }
}
