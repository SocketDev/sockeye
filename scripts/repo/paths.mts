/**
 * @file Canonical paths for Sockeye build outputs.
 */

import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from '../fleet/paths.mts'

export const BINARY_NAME = 'sockeye'

/**
 * Absolute path to the committed repo-asset directory (`assets/repo`).
 */
export const ASSETS_REPO_DIR = path.join(REPO_ROOT, 'assets', 'repo')

/**
 * Absolute path to the canonical brand-mark source raster. The `gen:logo`
 * generator traces this into `LOGOMARK_SVG_PATH`; keeping the raster in-repo
 * makes the generator self-contained and reproducible (code is law).
 */
export const BRAND_SOURCE_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'source',
  'sockeye-mark.png',
)

/**
 * Absolute path to the generated brand SVG (`assets/repo/brand/logomark.svg`).
 */
export const LOGOMARK_SVG_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'logomark.svg',
)

/**
 * Absolute path to the committed wordmark source raster. The `gen:wordmark`
 * generator traces the "sockeye" letterforms out of this into
 * `WORDMARK_SVG_PATH` (code is law — same bytes in, same SVG out).
 */
export const WORDMARK_SOURCE_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'source',
  'sockeye-wordmark.png',
)

/**
 * Absolute path to the generated wordmark SVG
 * (`assets/repo/brand/wordmark.svg`).
 */
export const WORDMARK_SVG_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'wordmark.svg',
)

/**
 * Absolute path to the generated combination mark
 * (`assets/repo/brand/combomark.svg`), composed from the logomark + wordmark by
 * `gen:combomark`.
 */
export const COMBOMARK_SVG_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'combomark.svg',
)

export function getBuildRoot(mode: string, platformArch: string): string {
  return path.join(REPO_ROOT, 'build', mode, platformArch)
}

export function getCmakeBuildDir(mode: string, platformArch: string): string {
  return path.join(getBuildRoot(mode, platformArch), 'cmake')
}

export function getOutputDir(mode: string, platformArch: string): string {
  return path.join(getBuildRoot(mode, platformArch), 'out', 'Final')
}

export function getBinaryPath(mode: string, platformArch: string): string {
  return path.join(getOutputDir(mode, platformArch), BINARY_NAME)
}

export function getNativeTestBinaryPath(name: string): string {
  const mode = process.env['BUILD_MODE'] ?? (process.env['CI'] ? 'prod' : 'dev')
  return path.join(
    getOutputDir(mode, `${process.platform}-${process.arch}`),
    name,
  )
}
