import os from 'node:os'
import path from 'node:path'

import { REPO_ROOT } from '../../fleet/paths.mts'

export const FINGERPRINT_RENDER_ROOT = path.join(
  REPO_ROOT,
  'assets',
  'repo',
  'fingerprint',
)
export const FINGERPRINT_MANIFEST = path.join(
  FINGERPRINT_RENDER_ROOT,
  'Cargo.toml',
)
export const FINGERPRINT_SOURCE = path.join(
  FINGERPRINT_RENDER_ROOT,
  'scan.json',
)
export const FINGERPRINT_ATLAS = path.join(
  REPO_ROOT,
  'src',
  'sockeye',
  'assets',
  'fingerprint-scan.png',
)
export const FINGERPRINT_BUILD_ROOT = path.join(
  os.tmpdir(),
  'sockeye-fframes-build',
)
export const FINGERPRINT_RENDERER = path.join(
  FINGERPRINT_BUILD_ROOT,
  'release',
  'sockeye-fingerprint-video',
)
export const FINGERPRINT_PREVIEW_ROOT = path.join(
  os.tmpdir(),
  'sockeye-fingerprint-preview',
)
export const FINGERPRINT_FRAMES_ROOT = path.join(
  FINGERPRINT_PREVIEW_ROOT,
  'frames',
)
