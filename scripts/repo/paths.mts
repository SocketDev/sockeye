/**
 * @file Canonical paths for Sockeye build outputs.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import {
  REPO_ROOT,
  resolvePackageJsonPath,
  segregatedConfigPath,
} from '../fleet/paths.mts'

export const BINARY_NAME = 'sockeye'

export const LOCKSTEP_MANIFEST_PATH = segregatedConfigPath(
  REPO_ROOT,
  'lockstep.json',
)

/**
 * Absolute path to the committed repo-asset directory (`assets/repo`).
 */
export const ASSETS_REPO_DIR = path.join(REPO_ROOT, 'assets', 'repo')

export const LOGOMARK_SVG_PATHS = [
  path.join(ASSETS_REPO_DIR, 'logomark.svg'),
  path.join(ASSETS_REPO_DIR, 'logomark-inverse.svg'),
]

/**
 * Resolve the active build mode. An explicit `BUILD_MODE` wins, CI defaults to
 * the release-shaped `prod` build, and a developer machine defaults to `dev`.
 * Every consumer that locates a built binary resolves the mode through here so
 * tests and scripts always look in the directory the build actually wrote.
 */
export function getBuildMode(): string {
  return getEnvValue('BUILD_MODE') ?? (getEnvValue('CI') ? 'prod' : 'dev')
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

export function getAgentCiDistFile(dist: string, filename: string): string {
  return path.join(dist, filename)
}

export function getAgentCiPackagePaths(repository: string): {
  dist: string
  entry: string
  packageJson: string
} {
  const require = createRequire(resolvePackageJsonPath(repository))
  const launcher = require.resolve('run-local-ci/native-launcher')
  const dist = path.dirname(launcher)
  return {
    __proto__: null,
    dist,
    entry: getAgentCiDistFile(dist, 'cli.js'),
    packageJson: resolvePackageJsonPath(path.dirname(dist)),
  } as { dist: string; entry: string; packageJson: string }
}

export const KEYCHAIN_INTERACTIVE_SUITE = path.join(
  REPO_ROOT,
  'test',
  'repo',
  'e2e',
  'keychain-lifecycle.test.mts',
)

export const KEYCHAIN_VALIDATION_RUNBOOK = path.join(
  REPO_ROOT,
  'docs',
  'keychain-validation.md',
)
