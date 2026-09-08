/**
 * Centralized path resolution for dawn-builder.
 *
 * Source of truth for all build paths (per `1 path, 1 reference`).
 * Other dawn-builder scripts (build, clean, future test/check
 * scripts) import these instead of constructing paths themselves.
 *
 * Node-smol-builder reads `BUILD_ROOT` + `UPSTREAM_DAWN_DIR` via the
 * workspace import `dawn-builder/scripts/paths` to find the prebuilt
 * libwebgpu_dawn.a + headers at link time.
 */

// Inherit canonical roots (REPO_ROOT, CONFIG_DIR, NODE_MODULES_CACHE_DIR,
// etc.) from the repo-root paths module per fleet rule
// `paths-mts-inherit-guard`.
export * from '../../../scripts/fleet/paths.mts'

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Package root: packages/dawn-builder/
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Build outputs land under build/<mode>/<platform-arch>/ per the
// canonical fleet layout. See packages/yoga-layout-builder for the
// reference shape.
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

// Upstream Dawn submodule root. Sparse-checkout via .gitmodules
// limits the disk footprint; see D2 commit for the sparse-checkout
// config + submodule pin.
export const UPSTREAM_DAWN_DIR = path.join(PACKAGE_ROOT, 'upstream', 'dawn')

/**
 * Per-mode (`dev` | `prod`) + per-platform-arch build paths.
 *
 * Output layout:
 * build/<mode>/<platform-arch>/cmake/      — cmake configure output
 * build/<mode>/<platform-arch>/out/
 * lib/libwebgpu_dawn.a                   — static library
 * include/                               — headers (dawn/, tint/, etc.)
 */
export function getBuildPaths(
  mode: 'dev' | 'prod',
  platformArch: string,
): {
  buildDir: string
  cmakeDir: string
  outputDir: string
  outputLibFile: string
  outputIncludeDir: string
} {
  const buildDir = path.join(BUILD_ROOT, mode, platformArch)
  const cmakeDir = path.join(buildDir, 'cmake')
  const outputDir = path.join(buildDir, 'out')
  return {
    buildDir,
    cmakeDir,
    outputDir,
    outputLibFile: path.join(outputDir, 'lib', 'libwebgpu_dawn.a'),
    outputIncludeDir: path.join(outputDir, 'include'),
  }
}

export const UPSTREAM_DAWN_DEPS = path.join(UPSTREAM_DAWN_DIR, 'DEPS')
export const UPSTREAM_DAWN_GIT = path.join(UPSTREAM_DAWN_DIR, '.git')
export const UPSTREAM_DAWN_MOVED_GIT = path.join(
  UPSTREAM_DAWN_DIR,
  '.git.moved-for-tint-gen',
)
const UPSTREAM_DAWN_INCLUDE_DIR = path.join(UPSTREAM_DAWN_DIR, 'include')

export function getDawnBuiltLibraryPath(cmakeDir: string): string {
  return path.join(cmakeDir, 'src', 'dawn', 'native', 'libwebgpu_dawn.a')
}

export function getDawnHeaderPaths(
  outputIncludeDir: string,
): Array<{ src: string; dst: string }> {
  return ['dawn', 'webgpu'].map(name => ({
    __proto__: null,
    src: path.join(UPSTREAM_DAWN_INCLUDE_DIR, name),
    dst: path.join(outputIncludeDir, name),
  }))
}

export function getTintGenerationPaths(cmakeDir: string) {
  const genOutDir = path.join(cmakeDir, 'gen')
  const genBinDir = path.join(cmakeDir, '.gen-bin')
  return {
    __proto__: null,
    genOutDir,
    genBinDir,
    genBin: path.join(
      genBinDir,
      process.platform === 'win32' ? 'gen.exe' : 'gen',
    ),
    enumsCc: path.join(genOutDir, 'src', 'tint', 'lang', 'core', 'enums.cc'),
  }
}
