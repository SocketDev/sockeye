// max-file-lines: orchestrator -- top-down pipeline (gather → validate → report); splitting fractures the flow

/**
 * @file Release Binary Build Phase
 *   This script handles the "Release" build phase:
 *
 *   1. Pre-flight checks (tools, environment, compression tools)
 *   2. Source cloning/extraction
 *   3. Patch application
 *   4. Node.js configuration
 *   5. Compilation
 *   6. Binary testing
 *   7. Release checkpoint creation This is the most complex phase containing all
 *      the Node.js build logic.
 */

import { existsSync } from 'node:fs'
import { calculateCpuCount } from '../../common/shared/parse-build-args.mts'

import {
  clearBuildLog,
  needsCacheRebuild,
  saveBuildLog,
} from 'local-build-infra/lib/build-operations'
import { shouldRun } from 'local-build-infra/lib/checkpoint-manager'
import {
  CHECKPOINT_CHAINS,
  CHECKPOINTS,
  nodeVersionRaw,
  validateCheckpointChain,
} from 'local-build-infra/lib/constants'
import { getCurrentPlatformArch } from 'local-build-infra/lib/platform-mappings'
import colors from 'yoctocolors-cjs'
import process from 'node:process'

import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'
import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { copyBuildAdditions } from './copy-additions.mts'
import { getReleaseConfigureFlags } from './release-configure.mts'
import { finalizeReleaseBinary } from './release-artifact.mts'
import { inspectReleaseCheckpoints } from './release-checkpoints.mts'
import {
  compileReleaseBinary,
  configureReleaseBinary,
} from './release-compile.mts'
import {
  resetReleaseSource,
  restoreReleaseSource,
  verifyReleaseSource,
} from './release-source.mts'
import { PATCHES_SOURCE_PATCHED_DIR } from './paths.mts'
import {
  checkBuildEnvironment,
  checkRequiredTools,
} from './preflight-checks.mts'
import { prepareExternalSources } from './prepare-external-sources.mts'
import { cloneNodeSource } from '../../source-copied/shared/copy-source.mts'
import { applySocketPatches } from '../../source-patched/shared/apply-patches.mts'

const logger = getDefaultLogger()

/**
 * Build Release binary phase.
 *
 * Takes one config object carrying the whole build context. Required
 * properties are validated at runtime by the requiredProps check below, so
 * a missing one fails fast with a named error.
 *
 * @param {object} config - Build options; the field-by-field reference lives
 *   in the docs page.
 * @param {object} [buildOptions] - Phase options; skipCheckpoint skips the
 *   checkpoint write.
 *
 *   Full discussion: docs/agents.md/repo/release-build-pipeline.md.
 */
export async function buildRelease(config, buildOptions = {}) {
  const { skipCheckpoint = false } = buildOptions
  const {
    allowCross,
    arch,
    autoYes,
    buildDir,
    buildMode,
    buildPatchesDir,
    cacheDir,
    cleanBuild,
    collectBuildSourceFiles,
    isProdBuild,
    libc,
    modeSourceDir,
    nodeBinary,
    nodeRepo,
    nodeSha,
    nodeVersion,
    outDir,
    outputReleaseBinary,
    packageName,
    packageRoot,
    patchedFile,
    platform,
    sharedBuildDir,
    sharedSourceDir,
    withDawn,
    withLief,
    // Extra ./configure flags appended verbatim after the standard set. The
    // bundle-driven compile (detect-bundle-features.mts → compile-for-bundle.mts)
    // passes the detector's `--without-smol-*` / `--without-sqlite` flags here to
    // drop subsystems a given SEA bundle doesn't use. Optional; defaults to none.
    extraConfigureFlags = [],
  } = config

  // Validate required config properties
  const requiredProps = [
    'arch',
    'buildDir',
    'buildMode',
    'modeSourceDir',
    'nodeBinary',
    'nodeRepo',
    'nodeVersion',
    'outDir',
    'outputReleaseBinary',
    'outputReleaseDir',
    'packageRoot',
    'platform',
    'sharedBuildDir',
    'sharedSourceDir',
  ]
  for (let i = 0, { length } = requiredProps; i < length; i += 1) {
    const prop = requiredProps[i]
    if (config[prop] === undefined) {
      throw new Error(
        `buildRelease: missing required config property '${prop}'`,
      )
    }
  }

  const IS_MACOS = platform === 'darwin'
  const IS_WINDOWS = platform === 'win32'
  const IS_LINUX = platform === 'linux'
  const IS_MUSL = libc === 'musl'
  const IS_DEV_BUILD = !isProdBuild

  /**
   * Collect build source files for cache validation.
   */
  function collectSourceFiles() {
    return collectBuildSourceFiles()
  }

  /**
   * Calculate optimal number of parallel build jobs.
   */
  const CPU_COUNT = calculateCpuCount()

  // ============================================================================
  // MAIN RELEASE BUILD LOGIC
  // ============================================================================

  logger.log('')
  logger.log('🔨 Socket CLI - Custom Node.js Builder')
  logger.log(`   Building Node.js ${nodeVersion} with custom patches`)
  logger.log('')

  // Initialize the build log. Clearing previous runs keeps logs from accumulating.
  await clearBuildLog(buildDir)
  await saveBuildLog(buildDir, '━'.repeat(60))
  await saveBuildLog(buildDir, '  Socket CLI - Custom Node.js Builder')
  await saveBuildLog(buildDir, `  Node.js ${nodeVersion} with custom patches`)
  await saveBuildLog(buildDir, `  Started: ${new Date().toISOString()}`)
  await saveBuildLog(buildDir, '━'.repeat(60))
  await saveBuildLog(buildDir, '')

  // Phase 1: Pre-flight checks.
  await saveBuildLog(buildDir, 'Phase 1: Pre-flight Checks')
  await checkRequiredTools({ arch, autoYes })
  await checkBuildEnvironment(buildDir)
  await saveBuildLog(buildDir, 'Pre-flight checks completed')
  await saveBuildLog(buildDir, '')

  // Ensure build directory exists.
  await safeMkdir(buildDir, { recursive: true })

  if (
    await inspectReleaseCheckpoints({
      buildDir,
      checkpointChain: getCheckpointChain(buildMode),
      packageName,
      packageRoot,
    })
  ) {
    return { __proto__: null, releaseBinaryPath: outputReleaseBinary }
  }

  // Check if we can use cached build.
  if (!cleanBuild) {
    // Collect all source files.
    const sourcePaths = await collectSourceFiles()

    // Check if build is needed.
    const needsRebuild = await needsCacheRebuild(cacheDir, sourcePaths)

    if (!needsRebuild && existsSync(outputReleaseBinary)) {
      // Cache hit!
      logger.log('')
      logger.success('Using cached build')
      logger.log('All source files unchanged since last build.')
      logger.log('')
      logger.substep(`Release binary: ${outputReleaseBinary}`)
      logger.log('')
      logger.success('Cached build is ready to use')
      logger.log('')
      return {
        __proto__: null,
        cached: true,
        releaseBinaryPath: outputReleaseBinary,
      }
    }
  }

  // Phase 2: Clone Node.js source to shared directory (source-cloned checkpoint).
  await cloneNodeSource({
    cleanBuild,
    nodeRepo,
    nodeSha,
    nodeVersion,
    packageName,
    packageRoot,
    sharedBuildDir,
    sharedSourceDir,
  })

  await resetReleaseSource(config)

  // Prepare external sources (copy from monorepo packages to additions/).
  // This must run BEFORE checkpoint restoration to ensure checkpoints
  // include fresh source files from bin-infra, binject, and build-infra packages.
  await prepareExternalSources({
    buildMode,
    platformArch: await getCurrentPlatformArch(),
  })

  await restoreReleaseSource(config)

  // Copy build additions.
  await copyBuildAdditions(modeSourceDir)

  // Phase 3: Apply Socket patches (source-patched checkpoint).
  await applySocketPatches({
    buildDir,
    buildPatchesDir,
    cleanBuild,
    modeSourceDir,
    nodeVersion,
    packageName,
    patchedFile,
    patchesReleaseDir: PATCHES_SOURCE_PATCHED_DIR,
  })

  // Verify modifications.
  await verifyReleaseSource(config)

  // Configure Node.js.
  logger.step('Configuring Node.js Build')

  if (IS_DEV_BUILD) {
    logger.log(
      `${colors.cyan('🚀 DEV BUILD MODE')} - Fast builds, larger binaries`,
    )
    logger.log('')
    logger.log(
      'Expected binary size: ~80-90MB (before stripping), ~50-55MB (after)',
    )
    logger.log('Expected build time: ~50% faster than production builds')
  } else {
    logger.log(
      `${colors.magenta('⚡ PRODUCTION BUILD MODE')} - Optimized for size/distribution`,
    )
    logger.log('')
    logger.log(
      'Expected binary size: ~75MB (before stripping), ~60-65MB (after)',
    )
  }
  logger.log('')

  const { configureFlags, isCrossCompiling } =
    await getReleaseConfigureFlags(config)

  // Collect build source files.
  const buildSourcePaths = await collectSourceFiles()

  // Check if we need to build.
  const needsBuild = await shouldRun(
    buildDir,
    packageName,
    CHECKPOINTS.BINARY_RELEASED,
    {
      arch,
      buildMode: isProdBuild ? 'prod' : 'dev',
      configureFlags: configureFlags.toSorted().join(','),
      libc,
      nodeVersion: nodeVersionRaw,
      platform,
      withLief,
      force: cleanBuild,
      sourcePaths: buildSourcePaths,
    },
  )

  if (needsBuild) {
    const configuration = await configureReleaseBinary({
      configureFlags,
      modeSourceDir,
      outDir,
    })
    if (!isWin32()) {
      await compileReleaseBinary({
        ...configuration,
        buildDir,
        jobCount: CPU_COUNT,
        modeSourceDir,
        platform,
      })
    }
  } else {
    logger.log('')
  }

  return finalizeReleaseBinary({
    ...config,
    buildSourcePaths,
    configureFlags,
    isCrossCompiling,
    skipCheckpoint,
  })
}

/**
 * Get checkpoint chain for progressive restoration (newest → oldest).
 * Matches CI restore-checkpoint action chain.
 *
 * Uses centralized CHECKPOINT_CHAINS registry from build-infra. CI workflows
 * should use this same function to generate their checkpoint chain.
 *
 * @param {string} _buildMode - Build mode ('dev' or 'prod') - unused for
 *   node-smol but kept for API consistency.
 *
 * @returns {string[]} Checkpoint chain array
 */
export function getCheckpointChain(_buildMode) {
  const chain = CHECKPOINT_CHAINS.nodeSmol()
  validateCheckpointChain(chain, 'build-released')
  return chain
}
