import { existsSync, promises as fs } from 'node:fs'
import { printError } from 'local-build-infra/lib/build-output'
import { errorMessage } from 'local-build-infra/lib/error-utils'
import {
  restoreCheckpoint,
  shouldRun,
} from 'local-build-infra/lib/checkpoint-manager'
import { CHECKPOINTS, nodeVersionRaw } from 'local-build-infra/lib/constants'
import { which } from '@socketsecurity/lib-stable/exe/path/which'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { LOG_SYMBOLS } from '@socketsecurity/lib-stable/logger/symbols'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  getReleaseCheckpointPaths,
  PATCHES_SOURCE_PATCHED_DIR,
} from './paths.mts'
import { computePatchChainCachePaths } from '../../source-patched/shared/apply-patches.mts'

const logger = getDefaultLogger()

export async function isNodeSourceDirty(modeSourceDir: string) {
  try {
    const gitPath = await which('git', { nothrow: true })
    if (!gitPath) {
      return false
    }
    const result = await spawn(gitPath, ['status', '--porcelain'], {
      cwd: modeSourceDir,
    })
    return result.code === 0 && (result.stdout ?? '').trim().length > 0
  } catch {
    return false
  }
}

export async function resetReleaseSource(config) {
  const {
    autoYes,
    buildDir,
    buildPatchesDir,
    cleanBuild,
    modeSourceDir,
    packageName,
  } = config
  // Check if mode source needs to be reset before extraction.
  // This handles two cases:
  // 1. Source exists but the upstream-Node-touching patch chain is stale
  //    (a patch file changed, or the pristine Node source under modeSourceDir
  //    differs from what the patches expect). In that case the patched tree
  //    is invalid — we must re-extract pristine source and re-apply patches.
  // 2. Source has uncommitted changes. Local development edited files.
  //
  // Addition source files (under packages/*/src/socketsecurity/...) get
  // copied into the source tree by copyBuildAdditions. They do NOT modify
  // upstream Node files, so iterating on them must NOT wipe the patched
  // tree or out/Release/ — the wipe decision uses computePatchChainCachePaths
  // (patches + upstream sentinels only), while applySocketPatches uses
  // the combined key (which includes additions) for its checkpoint
  // bookkeeping. The mismatch is intentional: we keep the patched source
  // and out/Release/ across addition-only edits, copyBuildAdditions
  // re-overlays the changed files, and ninja recompiles only the affected
  // .o. The checkpoint stays current because applySocketPatches re-runs
  // and refreshes the metadata even when it short-circuits.
  if (existsSync(modeSourceDir)) {
    logger.step('Checking Existing Node.js Source')

    const patchChainCachePaths = computePatchChainCachePaths({
      buildPatchesDir,
      modeSourceDir,
      patchesReleaseDir: PATCHES_SOURCE_PATCHED_DIR,
    })
    const needsPatching = await shouldRun(
      buildDir,
      packageName,
      CHECKPOINTS.SOURCE_PATCHED,
      { force: cleanBuild, sourcePaths: patchChainCachePaths },
    )

    if (needsPatching) {
      logger.warn(
        'Source exists but patches need to be applied - will re-extract pristine source',
      )
      await safeDelete(modeSourceDir)
      // Invalidate stale source-patched tarball so the restore phase
      // below falls through to source-copied (the pristine baseline
      // that the new patches expect).
      const checkpointPaths = getReleaseCheckpointPaths(
        buildDir,
        CHECKPOINTS.SOURCE_PATCHED,
      )
      await safeDelete(checkpointPaths.archive)
      await safeDelete(checkpointPaths.metadata)
      logger.log('')
    } else {
      // Check for uncommitted changes only if we're not patching.
      const isDirty = await isNodeSourceDirty(modeSourceDir)
      if (isDirty) {
        if (!autoYes) {
          logger.warn('Node.js source has uncommitted changes')
          logger.substep(
            'These changes will be discarded to ensure a clean build',
          )
          logger.substep(
            'Press Ctrl+C now if you want to inspect the changes first',
          )
          logger.substep('Or wait 5 seconds to continue with automatic reset…')
          logger.logNewline()

          await new Promise(resolve => setTimeout(resolve, 5000))
          logger.log('')
        } else {
          logger.substep(
            `${LOG_SYMBOLS['warn']}  Node.js source has uncommitted changes (will re-extract with --yes)`,
          )
          logger.log('')
        }

        await safeDelete(modeSourceDir)
      } else {
        logger.success('Source is clean and ready')
        logger.log('')
      }
    }
  }
}

export async function restoreReleaseSource(config) {
  const { buildDir, buildMode, modeSourceDir, packageName, sharedBuildDir } =
    config
  // Extract source to mode-specific directory (if needed).
  // Try checkpoints in order from newest to oldest (progressive restoration).
  // This matches CI behavior where restore-checkpoint action walks backward.
  if (!existsSync(modeSourceDir)) {
    logger.step(`Extracting Node.js Source to ${buildMode} Build`)
    logger.substep('Looking for source checkpoints…')
    logger.log('')

    // Try source-patched first (mode-specific, already has patches applied)
    let restored = await restoreCheckpoint(
      buildDir,
      packageName,
      CHECKPOINTS.SOURCE_PATCHED,
      { destDir: buildDir },
    )

    if (restored) {
      logger.success(
        'Restored from source-patched checkpoint (patches already applied)',
      )
      logger.log('')
    } else {
      // Fall back to source-copied (shared, pristine source)
      logger.log('source-patched not found, trying source-copied…')
      logger.log('')

      restored = await restoreCheckpoint(
        sharedBuildDir,
        packageName,
        CHECKPOINTS.SOURCE_COPIED,
        { destDir: buildDir },
      )

      if (!restored) {
        printError('Source Extraction Failed', 'No source checkpoints found.', [
          'Neither source-patched nor source-copied checkpoints exist',
          'This should not happen - source-copied is created during copy phase',
          'Try running with --clean to re-copy from upstream',
        ])
        throw new Error('Source extraction failed')
      }

      logger.success('Restored from source-copied checkpoint')
      logger.log('')
    }
  }
}

export async function verifyReleaseSource(config: {
  testFile: string
  bootstrapFile: string
}) {
  const { testFile, bootstrapFile } = config
  logger.step('Verifying Socket Modifications')

  let allApplied = true

  // Check 1: V8 include paths.
  logger.log('Checking V8 include paths…')
  try {
    const content = await fs.readFile(testFile, 'utf8')
    if (content.includes('#include "src/base/iterator.h"')) {
      logger.success(
        `V8 include paths are correct (no modification needed for v${nodeVersionRaw})`,
      )
    } else if (content.includes('#include "base/iterator.h"')) {
      logger.fail('V8 include paths were incorrectly modified!')
      logger.substep(`v${nodeVersionRaw} needs "src/" prefix in includes`)
      logger.substep('Build will fail - source was corrupted')
      allApplied = false
    } else {
      logger.warn('V8 include structure may have changed (cannot verify)')
    }
  } catch (e) {
    logger.warn(`Cannot verify V8 includes: ${errorMessage(e)}`)
  }

  // Check 2: localeCompare polyfill.
  // The patch adds: require('internal/socketsecurity/polyfills/locale-compare')
  logger.log('Checking polyfill in bootstrap/node.js…')
  try {
    const content = await fs.readFile(bootstrapFile, 'utf8')
    const hasLocaleCompare = content.includes(
      "require('internal/socketsecurity/polyfills/locale-compare')",
    )

    if (hasLocaleCompare) {
      logger.success(
        'bootstrap/node.js correctly modified (localeCompare polyfill applied)',
      )
    } else {
      logger.warn('localeCompare polyfill not applied')
    }
  } catch (e) {
    logger.warn(`Cannot verify bootstrap/node.js: ${errorMessage(e)}`)
  }

  logger.logNewline()

  if (!allApplied) {
    printError(
      'Socket Modifications Not Applied',
      'Critical Socket modifications were not applied to Node.js source.',
      [
        'V8 include paths or bootstrap polyfills are missing or corrupted',
        'This typically happens when patches failed to apply correctly',
        'Check the build log for patch application errors',
        'Run: pnpm build --clean',
        'If issue persists, check patches in patches/source-patched/',
      ],
    )
    throw new Error('Socket modifications verification failed')
  }

  logger.success('All Socket modifications verified for --with-intl=small-icu')
  logger.logNewline()
}
