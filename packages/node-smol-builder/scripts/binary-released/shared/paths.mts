/**
 * Paths used by binary-released checkpoint scripts.
 *
 * Re-exports infrastructure paths from root, and defines checkpoint-specific
 * paths.
 */

import path from 'node:path'

import {
  BINFLATE_DIR,
  BINPRESS_DIR,
  getBuildPaths,
  getSharedBuildPaths,
  PACKAGE_ROOT,
} from '../../paths.mts'

// Re-export infrastructure paths
export {
  BINFLATE_DIR,
  BINPRESS_DIR,
  PACKAGE_ROOT,
  getBuildPaths,
  getSharedBuildPaths,
}

// Checkpoint-specific paths (defined here, not in root paths.mts)
// Note: Using 'source-patched' checkpoint name (aligned with createCheckpoint calls)
export const PATCHES_SOURCE_PATCHED_DIR = path.join(
  PACKAGE_ROOT,
  'patches',
  'source-patched',
)

export const ADDITIONS_SOURCE_PATCHED_DIR = path.join(
  PACKAGE_ROOT,
  'additions',
  'source-patched',
)

export const LSQUIC_PATCHED_DIR = path.join(
  ADDITIONS_SOURCE_PATCHED_DIR,
  'deps',
  'lsquic',
)

export function getReleaseCheckpointPaths(
  buildDir: string,
  checkpointName: string,
) {
  const checkpointDir = path.join(buildDir, 'checkpoints')
  return {
    __proto__: null,
    archive: path.join(checkpointDir, `${checkpointName}.tar.gz`),
    metadata: path.join(checkpointDir, `${checkpointName}.json`),
  }
}
