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

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  clearBuildLog,
  createCheckpoint,
  estimateBuildTime,
  exec,
  formatDuration,
  getBuildLogPath,
  getFileSize,
  getLastLogLines,
  needsCacheRebuild,
  saveBuildLog,
  smokeTestBinary,
} from 'local-build-infra/lib/build-helpers'
import { printError } from 'local-build-infra/lib/build-output'
import { errorMessage } from 'local-build-infra/lib/error-utils'
import { shouldRun } from 'local-build-infra/lib/checkpoint-manager'
import {
  CHECKPOINT_CHAINS,
  CHECKPOINTS,
  nodeVersionRaw,
  validateCheckpointChain,
} from 'local-build-infra/lib/constants'
import { getCurrentPlatformArch } from 'local-build-infra/lib/platform-mappings'
import { appendCCRemapFlags } from 'local-build-infra/lib/path-remap-flags'
import colors from 'yoctocolors-cjs'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { copyBuildAdditions } from './copy-additions.mts'
import { getReleaseConfigureFlags } from './release-configure.mts'
import { inspectReleaseCheckpoints } from './release-checkpoints.mts'
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
  const CPU_COUNT = (() => {
    // Check for explicit override via environment variable
    if (process.env['BUILD_JOBS']) {
      const envJobs = Number.parseInt(process.env['BUILD_JOBS'], 10)
      if (Number.isNaN(envJobs) || envJobs < 1) {
        throw new Error(
          `Invalid BUILD_JOBS value: ${process.env['BUILD_JOBS']} (must be a positive integer)`,
        )
      }
      return envJobs
    }

    // Adaptive calculation based on available memory
    const totalCpus = os.cpus().length
    const totalRamGB = Math.floor(os.totalmem() / (1024 * 1024 * 1024))
    const memoryBasedJobs = Math.floor(totalRamGB / 4)

    // Use the minimum of CPU count and memory-based calculation
    // Ensure at least 1 job even on very low-memory systems
    return Math.max(1, Math.min(totalCpus, memoryBasedJobs))
  })()

  /**
   * Convert configure.py flags to vcbuild.bat flags.
   */
  function convertToVcbuildFlags(configureFlags) {
    const vcbuildFlags = []

    // Always add openssl-no-asm
    vcbuildFlags.push('openssl-no-asm')
    vcbuildFlags.push('download-all')

    const flagMap = {
      '--without-node-options': 'no-NODE-OPTIONS',
      '--without-npm': 'nonpm',
      '--without-snapshot': 'nosnapshot',
    }

    for (let i = 0, { length } = configureFlags; i < length; i += 1) {
      const flag = configureFlags[i]
      if (flag === '--dest-cpu=arm64') {
        vcbuildFlags.push('arm64')
      } else if (flag === '--dest-cpu=x64') {
        vcbuildFlags.push('x64')
      } else if (flag === '--with-intl=small-icu') {
        // Windows: use full-icu (downloads ICU data). small-icu on Windows
        // has ICU data generation issues (MSB8066 in icudata.vcxproj).
        vcbuildFlags.push('full-icu')
      } else if (flag === '--with-intl=none') {
        vcbuildFlags.push('intl-none')
      } else if (flag === '--enable-lto') {
        vcbuildFlags.push('ltcg')
      } else if (flag === '--ninja') {
        // No-op: Ninja is default
      } else if (flag === '--experimental-enable-pointer-compression') {
        // No-op: V8 pointer compression is already default in Node.js
      } else if (flag in flagMap) {
        vcbuildFlags.push(flagMap[flag])
      } else if (flag.startsWith('--without-')) {
        // No-op: Most unsupported
      } else {
        logger.warn(`Unknown vcbuild.bat flag mapping for: ${flag}`)
      }
    }

    return vcbuildFlags
  }

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
    // Clean build directory.
    logger.step('Cleaning Build Directory')
    if (existsSync(outDir)) {
      logger.log(`Removing ${outDir} to prevent ninja duplicate rules…`)
      await safeDelete(outDir)
      logger.success(`Cleaned ${outDir}`)
      logger.log('')
    } else {
      logger.log('No out/ directory found (clean state)')
      logger.log('')
    }

    // Windows: Clean stale junction links.
    if (isWin32()) {
      const configDirs = ['Release', 'Debug']
      for (let i = 0, { length } = configDirs; i < length; i += 1) {
        const configDir = configDirs[i]
        const junctionPath = path.join(modeSourceDir, configDir)
        if (existsSync(junctionPath)) {
          logger.log(`Removing stale ${configDir} directory/junction…`)
          await exec('cmd.exe', ['/c', `rd /S /Q "${configDir}"`], {
            cwd: modeSourceDir,
          })
          logger.log(`Removed ${configDir}`)
        }
      }
    }

    // Configure.
    const configureCommand = isWin32() ? 'vcbuild.bat' : './configure'
    const configureArgs = isWin32()
      ? convertToVcbuildFlags(configureFlags)
      : configureFlags

    logger.log(`::group::Running ${isWin32() ? 'vcbuild.bat' : './configure'}`)

    // Anonymize absolute build-host paths in DWARF and __FILE__ macros so the
    // shipped node-smol binary doesn't carry the dev's home dir... or
    // the dev's home dir... strings. Node.js's ./configure passes CFLAGS/CXXFLAGS
    // through to GYP-generated build files, which propagates to ninja.
    const buildEnv = {
      ...process.env,
      CFLAGS: appendCCRemapFlags(process.env['CFLAGS']),
      CXXFLAGS: appendCCRemapFlags(process.env['CXXFLAGS']),
    }

    await exec(configureCommand, configureArgs, {
      cwd: modeSourceDir,
      env: buildEnv,
      shell: isWin32(),
    })
    logger.log('::endgroup::')
    logger.log(
      // Emoji is wrapped in colors.green() decorator before being embedded in
      // multi-line build summary; logger.success() would drop the color.
      // oxlint-disable-next-line socket/no-status-emoji -- see above
      `${colors.green('✓')} ${isWin32() ? 'Build' : 'Configuration'} complete`,
    )
    logger.log('')

    if (isWin32()) {
      logger.success('Windows build completed by vcbuild.bat')
      logger.log('')
    } else {
      logger.step('Building Node.js')
    }
  }

  // Compile (Unix only, Windows already done).
  if (!needsBuild) {
    logger.log('')
  } else if (!isWin32()) {
    const jobCount = CPU_COUNT
    const timeEstimate = estimateBuildTime(jobCount)

    const totalCpus = os.cpus().length
    const totalRamGB = Math.floor(os.totalmem() / (1024 * 1024 * 1024))
    const isMemoryConstrained = jobCount < totalCpus
    const isEnvOverride = Boolean(process.env['BUILD_JOBS'])

    logger.log(
      `⏱️  Estimated time: ${timeEstimate.estimatedMinutes} minutes (${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} min range)`,
    )

    if (isEnvOverride) {
      logger.log(
        `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation (BUILD_JOBS override)`,
      )
    } else if (isMemoryConstrained) {
      logger.log(
        `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation (${totalCpus} CPUs available, reduced for ${totalRamGB}GB RAM)`,
      )
      logger.log(
        '   Memory-optimized build to prevent resource exhaustion (each job uses ~400-800MB RAM)',
      )
    } else {
      logger.log(
        `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation`,
      )
    }
    logger.log('')
    logger.log('Starting build…')
    logger.log('')

    // Clean macOS AppleDouble files that may have been restored from checkpoints
    // These ._* files cause ninja to fail trying to compile binary metadata as C++
    if (platform !== 'darwin') {
      try {
        const findResult = await spawn(
          'find',
          [modeSourceDir, '-name', '._*', '-type', 'f', '-delete'],
          { stdio: 'pipe' },
        )
        if (findResult.code === 0) {
          logger.log('Cleaned macOS AppleDouble files from source tree')
        }
      } catch {
        // find not available or failed - non-fatal, build may still succeed
      }
    }

    const buildStart = Date.now()

    logger.log(
      '::group::Compiling Node.js with Ninja (this will take a while...)',
    )

    // Guard against stale build.ninja: if node.gyp (mutated by
    // patch 004 + friends) is newer than out/Release/build.ninja,
    // re-run configure so ninja sees the current source list.
    // Round 4 hit this with icu_*_backend.cc — the patched gyp had
    // the sources, but build.ninja was generated by an earlier
    // configure that predated the addition, so the .o files never
    // got built and the link failed with unresolved symbols. Cheap
    // mtime check beats a "run configure unconditionally" sledgehammer.
    const ninjaPath = path.join(modeSourceDir, 'out/Release/build.ninja')
    const gypPath = path.join(modeSourceDir, 'node.gyp')
    try {
      const { 0: ninjaStat, 1: gypStat } = await Promise.all([
        // oxlint-disable-next-line socket/prefer-exists-sync -- need mtimeMs for staleness comparison
        fs.stat(ninjaPath),
        // oxlint-disable-next-line socket/prefer-exists-sync -- need mtimeMs for staleness comparison
        fs.stat(gypPath),
      ])
      if (gypStat.mtimeMs > ninjaStat.mtimeMs) {
        logger.warn(
          `node.gyp is newer than build.ninja (${new Date(gypStat.mtimeMs).toISOString()} > ${new Date(ninjaStat.mtimeMs).toISOString()}) — re-running configure to refresh ninja source list`,
        )
        await exec(isWin32() ? 'vcbuild.bat' : './configure', configureArgs, {
          cwd: modeSourceDir,
          env: buildEnv,
          shell: isWin32(),
        })
        logger.success('Configure re-run complete; ninja refreshed')
      }
    } catch (err) {
      // First-time build (no build.ninja yet) or stat failure — let
      // ninja itself surface the error.
    }
    /* oxlint-enable socket/prefer-exists-sync */

    try {
      const ninjaCommand = whichSync('ninja')
      await exec(ninjaCommand, ['-C', 'out/Release', `-j${CPU_COUNT}`], {
        cwd: modeSourceDir,
        env: process.env,
      })
      logger.log('::endgroup::')
    } catch (e) {
      logger.log('::endgroup::')
      logger.log('')
      logger.log('::error::Ninja build failed - see collapsed section above')
      logger.log('')

      const lastLines = await getLastLogLines(buildDir, 100)
      if (lastLines) {
        logger.error()
        logger.error('Last 100 lines of build log:')
        logger.error('━'.repeat(60))
        logger.error(lastLines)
        logger.error('━'.repeat(60))
      }

      printError(
        'Build Failed',
        'Node.js compilation failed. See build log for details.',
        [
          `Full log: ${getBuildLogPath(buildDir)}`,
          'Try again with: pnpm build --clean',
        ],
      )
      throw e
    }

    const buildDuration = Date.now() - buildStart
    const buildTime = formatDuration(buildDuration)

    logger.log('')
    logger.success(`Build completed in ${buildTime}`)
    logger.log('')
  }

  // Test binary.
  // Will automatically fall back to static verification if cross-compiled.
  logger.step('Testing Binary (Release)')

  logger.log('Running comprehensive functionality tests…')
  logger.log('')

  const smokeTestPassed = await smokeTestBinary(
    nodeBinary,
    isCrossCompiling ? { arch } : {},
  )

  if (!smokeTestPassed) {
    printError(
      'Binary Failed Smoke Tests',
      'Binary failed comprehensive smoke tests after build',
      [
        'Build may have produced corrupted binary',
        'Try rebuilding: pnpm build --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Binary failed smoke tests')
  }

  logger.log('')
  logger.success('Binary is functional')
  logger.log('')

  // Copy to Release output.
  logger.step('Copying to Build Output (Release)')
  logger.log('Copying unmodified binary to Release directory…')
  logger.logNewline()

  const outputReleaseNodeDir = path.dirname(outputReleaseBinary)
  await safeMkdir(outputReleaseNodeDir, { recursive: true })
  await fs.cp(nodeBinary, outputReleaseBinary, {
    force: true,
    preserveTimestamps: true,
  })

  logger.substep(`Release directory: ${outputReleaseNodeDir}`)
  logger.substep('Binary: node (unmodified)')
  logger.logNewline()
  logger.success(`Unmodified binary copied to ${outputReleaseNodeDir}`)
  logger.logNewline()

  // Clean Release directory before checkpoint to ensure only the release binary is archived
  // This removes any leftover files from previous builds
  if (!skipCheckpoint) {
    logger.substep('Cleaning checkpoint directory…')
    const releaseDirFiles = await fs.readdir(outputReleaseNodeDir)
    const releaseBinaryName = path.basename(outputReleaseBinary)
    for (let i = 0, { length } = releaseDirFiles; i < length; i += 1) {
      const file = releaseDirFiles[i]
      if (file !== releaseBinaryName) {
        const filePath = path.join(outputReleaseNodeDir, file)
        await safeDelete(filePath)
        logger.substep(`Removed: ${file}`)
      }
    }
    logger.logNewline()

    // Create Release checkpoint.
    const releaseBinarySize = await getFileSize(outputReleaseBinary)
    await createCheckpoint(
      buildDir,
      CHECKPOINTS.BINARY_RELEASED,
      async () => {
        // Use smokeTestBinary with automatic fallback for cross-compiled builds
        const validated = await smokeTestBinary(
          outputReleaseBinary,
          isCrossCompiling ? { arch } : {},
        )
        if (!validated) {
          throw new Error('Binary validation failed')
        }
        logger.substep('Binary validated')
      },
      {
        arch,
        artifactPath: outputReleaseNodeDir,
        binarySize: releaseBinarySize,
        buildMode: isProdBuild ? 'prod' : 'dev',
        configureFlags: configureFlags.toSorted().join(','),
        libc,
        nodeVersion: nodeVersionRaw,
        packageName,
        packageRoot,
        platform,
        sourcePaths: buildSourcePaths,
        withLief,
      },
    )
    logger.log('')
  }

  return {
    __proto__: null,
    buildSourcePaths,
    isCrossCompiling,
    releaseBinaryPath: outputReleaseBinary,
  }
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
