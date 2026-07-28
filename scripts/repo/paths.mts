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
 * Absolute path to the canonical brand-mark vector
 * (`assets/repo/brand/sockeye-logomark.svg`).
 */
export const LOGOMARK_SVG_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'sockeye-logomark.svg',
)

/**
 * Square, embeddable favicon derived from the canonical Sockeye logomark.
 */
export const FAVICON_SVG_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'sockeye-favicon.svg',
)

/**
 * Absolute path to the canonical wordmark vector
 * (`assets/repo/brand/sockeye-wordmark.svg`).
 */
export const WORDMARK_SVG_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'sockeye-wordmark.svg',
)

/**
 * Absolute path to the generated combination mark
 * (`assets/repo/brand/sockeye-combomark.svg`), composed from the logomark +
 * wordmark by
 * `gen:combomark`.
 */
export const COMBOMARK_SVG_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'sockeye-combomark.svg',
)

export const COMBOMARK_LIGHT_SVG_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'sockeye-combomark-light.svg',
)

export const COMBOMARK_DARK_SVG_PATH = path.join(
  ASSETS_REPO_DIR,
  'brand',
  'sockeye-combomark-dark.svg',
)

/**
 * Resolve the active build mode. An explicit `BUILD_MODE` wins, CI defaults to
 * the release-shaped `prod` build, and a developer machine defaults to `dev`.
 * Every consumer that locates a built binary resolves the mode through here so
 * tests and scripts always look in the directory the build actually wrote.
 */
export function getBuildMode(): string {
  return process.env['BUILD_MODE'] ?? (process.env['CI'] ? 'prod' : 'dev')
}

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
  return path.join(
    getOutputDir(getBuildMode(), `${process.platform}-${process.arch}`),
    name,
  )
}
