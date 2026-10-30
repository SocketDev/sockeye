/**
 * @file Canonical paths for Sockeye build outputs.
 */

import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { resolveBuildMode } from '../fleet/build/mode.mts'

export * from '../fleet/paths.mts'

import {
  REPO_ROOT,
  resolvePackageJsonPath,
  segregatedConfigPath,
} from '../fleet/paths.mts'

export const BINARY_NAME = 'sockeye'
export const RELEASE_BUNDLE_NAME = `${BINARY_NAME}.app`

export function getInstalledSockeyeBinaryPath(
  homeDirectory = os.homedir(),
): string {
  return path.join(homeDirectory, '.socket', 'bin', BINARY_NAME)
}

export function getShellSockeyeBinaryPath(
  homeDirectory = os.homedir(),
): string {
  return path.join(homeDirectory, '.local', 'bin', BINARY_NAME)
}

export const RELEASE_BUNDLE_ENTRIES = [
  RELEASE_BUNDLE_NAME,
  `${RELEASE_BUNDLE_NAME}/Contents`,
  `${RELEASE_BUNDLE_NAME}/Contents/CodeResources`,
  `${RELEASE_BUNDLE_NAME}/Contents/Info.plist`,
  `${RELEASE_BUNDLE_NAME}/Contents/MacOS`,
  `${RELEASE_BUNDLE_NAME}/Contents/MacOS/${BINARY_NAME}`,
  `${RELEASE_BUNDLE_NAME}/Contents/_CodeSignature`,
  `${RELEASE_BUNDLE_NAME}/Contents/_CodeSignature/CodeResources`,
  `${RELEASE_BUNDLE_NAME}/Contents/embedded.provisionprofile`,
] as const
export const RELEASE_BUNDLE_DIRECTORY_ENTRIES = [
  RELEASE_BUNDLE_NAME,
  `${RELEASE_BUNDLE_NAME}/Contents`,
  `${RELEASE_BUNDLE_NAME}/Contents/MacOS`,
  `${RELEASE_BUNDLE_NAME}/Contents/_CodeSignature`,
] as const

export function releaseAssetName(architecture: string): string {
  return `${BINARY_NAME}-darwin-${architecture}.zip`
}

export function releaseBundlePath(binary: string): string {
  return releaseBundleDirectoryPath(path.dirname(binary))
}

export function releaseBundleDirectoryPath(directory: string): string {
  return path.join(directory, RELEASE_BUNDLE_NAME)
}

export function releaseBundlePaths(bundle: string) {
  const contents = path.join(bundle, 'Contents')
  return {
    __proto__: null,
    binary: path.join(contents, 'MacOS', BINARY_NAME),
    contents,
    info: path.join(contents, 'Info.plist'),
    profile: path.join(contents, 'embedded.provisionprofile'),
  }
}

export function releaseChecksumPath(archive: string): string {
  return `${archive}.sha256`
}

export function releaseNotaryEvidencePaths(output: string) {
  return {
    __proto__: null,
    log: `${output}.notary-log.json`,
    receipt: `${output}.notary-receipt.json`,
    submission: `${output}.notary-submission.zip`,
  }
}

export function releaseNotaryReceiptScratchPrefix(): string {
  return path.join(os.tmpdir(), 'sockeye-receipt-')
}

export function releaseNotaryWorkingPaths(output: string, nonce: string) {
  const finalArchive = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${nonce}.zip`,
  )
  return {
    __proto__: null,
    finalArchive,
    finalSidecar: releaseChecksumPath(finalArchive),
    unresolved: `${output}.notary-unresolved.json`,
  }
}

export function releaseProfileInspectionPaths(directory: string) {
  return {
    __proto__: null,
    plist: path.join(directory, 'profile.plist'),
    profile: path.join(directory, 'embedded.provisionprofile'),
  }
}

export function releaseProfilePath(profile: string): string {
  return path.resolve(profile)
}

export function getNodeHeaderDirectory(): string {
  return path.join(
    path.dirname(path.dirname(process.execPath)),
    'include',
    'node',
  )
}

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
 * Resolve the active build mode. Explicit mode flags win over `BUILD_MODE`.
 * Unconfigured builds default to `dev` on every host.
 * Every consumer that locates a built binary resolves the mode through here so
 * tests and scripts always look in the directory the build actually wrote.
 */
export function getBuildMode(): string {
  const args = process.argv.slice(2)
  const environmentMode = getEnvValue('BUILD_MODE')
  const mode = resolveBuildMode(args, {
    defaultMode: environmentMode === 'prod' ? 'prod' : 'dev',
  })
  return args.includes('--dev') || args.includes('--prod')
    ? mode
    : (environmentMode ?? mode)
}

export function getBuildModeArgs(mode: string): string[] {
  return ['dev', 'prod'].includes(mode) ? [`--${mode}`] : []
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

export function getNativeProfilePattern(directory: string): string {
  return path.join(directory, '%m-%p.profraw')
}
export function getDefaultNativeProfilePattern(buildDirectory: string): string {
  return getNativeProfilePattern(path.join(buildDirectory, 'profiles'))
}
export function getNativeCoverageReceiptPath(profiles: string): string {
  return path.join(profiles, 'vitest.json')
}
