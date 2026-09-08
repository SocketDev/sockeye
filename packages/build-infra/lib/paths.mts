/**
 * Shared path helpers for build infrastructure.
 *
 * These centralize path segments that would otherwise be hand-built across
 * packages — most notably the `build/downloaded` cache directory and the
 * binsuite `out/Final/<binary>` final-binary location. Per the
 * "One Path, One Reference" rule, every consumer imports from here instead
 * of joining the segments inline.
 */

import path from 'node:path'

import { BUILD_STAGES, PACKAGE_ROOT } from './constants.mts'

/**
 * Get the canonical download cache directory for a package.
 *
 * Used by builders that fetch prebuilt artifacts from GitHub releases as a
 * fallback to building from source. Each package has its own download cache
 * rooted at `{packageRoot}/build/downloaded`; consumers compose subdirectories
 * (per-tool, per-platformArch) on top of the base.
 *
 * @param {string} packageRoot - Absolute path to the package root.
 *
 * @returns {string} Absolute path to the package's download cache directory.
 */
export function builderCheckpointModePath(
  packageDir: string,
  buildDir: string,
  mode: string,
): string {
  return path.join(builderCleanDirectoryPath(packageDir, buildDir), mode)
}

export function builderCleanDirectoryPath(
  packageDir: string,
  directory: string,
): string {
  return path.join(packageDir, directory)
}

export function builderPackageFromCallerPath(callerPath: string): string {
  return path.resolve(path.dirname(callerPath), '..')
}

export function getBuildTempDir(packageRoot: string): string {
  return path.join(packageRoot, 'build', 'temp')
}

export function getConsumerManifestDirectoryPath(manifestPath: string): string {
  return path.dirname(manifestPath)
}

export function getDownloadedDir(packageRoot: string): string {
  return path.join(packageRoot, 'build', 'downloaded')
}

export function getEmscriptenCmakePath(homebrewPath: string): string {
  return path.join(
    homebrewPath,
    'libexec',
    'cmake',
    'Modules',
    'Platform',
    'Emscripten.cmake',
  )
}

export function getEmsdkRootFromCompilerPath(emccPath: string): string {
  return path.dirname(path.dirname(path.dirname(emccPath)))
}

export function getEmsdkScriptPath(sdkPath: string, platform: string): string {
  return path.join(sdkPath, platform === 'win32' ? 'emsdk.bat' : 'emsdk')
}

/**
 * Get the canonical final-binary path for a binsuite tool
 * (binpress, binflate, binject) for a specific build mode and platform.
 *
 * Mirrors the layout produced by `bin-infra/lib/builder.mts`'s
 * `buildBinSuitePackage`:
 * `{packageRoot}/build/{mode}/{platformArch}/out/Final/{binaryName}`. Use this
 * whenever a non-builder consumer (script, test helper, sibling package) needs
 * to find the output of a binsuite build.
 *
 * @param {string} packageRoot - Absolute path to the binsuite package root.
 * @param {string} mode - Build mode (`'dev'` or `'prod'`).
 * @param {string} platformArch - Platform-arch identifier (e.g.
 *   `'darwin-arm64'`).
 * @param {string} binaryName - Binary file name (e.g. `'binpress'`,
 *   `'binpress.exe'`).
 *
 * @returns {string} Absolute path to the final binary.
 */
export function getFinalBinaryPath(
  packageRoot: string,
  mode: string,
  platformArch: string,
  binaryName: string,
): string {
  return path.join(
    getFinalOutputDir(path.join(packageRoot, 'build', mode, platformArch)),
    binaryName,
  )
}

/**
 * Get the canonical `out/Final` directory below an existing build root.
 *
 * The root may be a mode directory, a platform directory, or a nested WASM
 * build directory. Keeping the stage segments here prevents scanners and
 * other generic consumers from reconstructing the same path.
 *
 * @param {string} buildRoot - Build directory that owns the `out` tree.
 *
 * @returns {string} Absolute path to its final output directory.
 */

export function getFinalOutputDir(buildRoot: string): string {
  return path.join(buildRoot, 'out', BUILD_STAGES.FINAL)
}

export const REPOSITORY_GITMODULES = path.join(
  PACKAGE_ROOT,
  '..',
  '..',
  '.gitmodules',
)

export function getPackageManifestPath(packageRoot: string): string {
  return path.join(packageRoot, 'package.json')
}
export function getPrebuiltDownloadDir(config: {
  packageRoot: string
  name: string
  platformArch: string
}): string {
  const { packageRoot, name, platformArch } = {
    __proto__: null,
    ...config,
  } as typeof config
  return path.join(getDownloadedDir(packageRoot), name, platformArch)
}

export function getPrebuiltMemberPath(
  extractDir: string,
  member: string,
): string {
  return path.join(extractDir, member)
}

export function getPrebuiltVersionPath(extractDir: string): string {
  return path.join(extractDir, '.version')
}

export function getPythonDefaultVenvPath(homeDir: string): string {
  return path.join(homeDir, '.socket-btm-venv')
}

export function getPythonPrefixCandidates(pipPath: string): string[] {
  const versionDir = path.dirname(path.dirname(pipPath))
  const pythonVersion = path.basename(versionDir)
  const libDir = path.dirname(versionDir)
  if (path.basename(libDir) !== 'lib') {
    return []
  }
  const binDir = path.join(path.dirname(libDir), 'bin')
  return ['python3', pythonVersion, 'python'].map(candidate =>
    path.join(binDir, candidate),
  )
}

export function getPythonVenvBinaryPaths(venvPath: string): {
  pipPath: string
  pythonPath: string
} {
  const binDir = path.join(venvPath, 'bin')
  return {
    pipPath: path.join(binDir, 'pip3'),
    pythonPath: path.join(binDir, 'python3'),
  }
}

export function getPythonVenvParentPath(venvPath: string): string {
  return path.dirname(venvPath)
}

export function getSocketSourceDir(packageRoot: string, name: string): string {
  return path.join(packageRoot, 'src', 'socketsecurity', name)
}

export const KEYSTORE_PACKAGE_ROOT = path.join(
  PACKAGE_ROOT,
  '..',
  'keystore-infra',
)
export const KEYSTORE_SOURCE_DIR = path.join(KEYSTORE_PACKAGE_ROOT, 'src')

export {
  BUILD_REQUIREMENTS_FILENAME,
  BUILD_REQUIREMENTS_PACKAGE_ROOT,
  BUILD_REQUIREMENTS_SCHEMA_PATH,
  ML_BUILD_REQUIREMENTS_FILENAME,
  getBuildRequirementsPath,
  getCheckpointRequirementsPath,
  isBuildRequirementsPath,
  resolveRequirementReference,
} from './build-requirements/paths.mts'

export const NODE_SOURCE_SUBMODULE_PATH =
  'packages/node-smol-builder/upstream/node'

export const BINARY_SMOKE_FIXTURES_DIR = path.join(
  PACKAGE_ROOT,
  'test',
  'fixtures',
)
export const BINARY_SMOKE_SIMPLE_FIXTURE = path.join(
  BINARY_SMOKE_FIXTURES_DIR,
  'smoke-test-simple.mjs',
)
export const BINARY_SMOKE_MODULES_FIXTURE = path.join(
  BINARY_SMOKE_FIXTURES_DIR,
  'smoke-test-modules.mjs',
)
export const BINARY_SMOKE_TEMPORAL_FIXTURE = path.join(
  BINARY_SMOKE_FIXTURES_DIR,
  'smoke-test-temporal.mjs',
)
