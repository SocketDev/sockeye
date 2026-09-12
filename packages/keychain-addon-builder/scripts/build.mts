#!/usr/bin/env node
import {
  getSocketSourceDir,
  KEYSTORE_PACKAGE_ROOT,
  KEYSTORE_SOURCE_DIR,
} from 'local-build-infra/lib/paths'
/**
 * @file Build the keychain `.node` addon: a direct-compiler build of the
 *   cross-platform N-API shim (keychain_napi.cc) + the host's keystore-infra
 *   backend into `keychain.node`. No node-gyp, no new deps (the napi-go-infra
 *   pattern) — N-API symbols resolve from the running Node. Sources are
 *   compiled to objects with the RIGHT language frontend, then linked — the
 *   shim is C++, but the Linux/Windows backends are C (compiling C as C++ trips
 *   on, e.g., libsecret's `{NULL, 0}` enum sentinel). Per platform-arch (runs
 *   for the HOST; CI runs it on each runner): darwin — keystore_macos.mm
 *   (ObjC++, -fobjc-arc) + Foundation/Security/ LocalAuthentication frameworks;
 *   `-undefined dynamic_lookup`. linux — keystore_linux.c (C) + libsecret
 *   (pkg-config libsecret-1); `-fPIC`. win32 — keystore_win.c (C) + Credential
 *   Manager (advapi32); links Node's import lib because a Windows DLL can't
 *   carry undefined symbols.
 */

import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from 'local-build-infra/lib/error-utils'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getKeychainAddonBinaryPath, getKeychainAddonOutDir } from './paths.mts'
import { getDefaultNativeProfilePattern } from '../../../scripts/repo/paths.mts'
import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'

const logger = getDefaultLogger()

/**
 * Run one compiler/linker invocation, throwing on a non-zero exit. The addon
 * build is three of these; nothing fancier from build-infra is needed.
 */
function execBuildCommand(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdioString: true })
  if (result.status !== 0) {
    throw new Error(
      `${command} exited ${String(result.status)}: ${result.stderr}`,
    )
  }
}

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const keystoreDir = getSocketSourceDir(KEYSTORE_PACKAGE_ROOT, 'keystore-infra')
const shim = path.join(
  packageRoot,
  'src',
  'socketsecurity',
  'keychain-addon-builder',
  'keychain_napi.cc',
)

export interface PlatformBuild {
  // C++ compiler/linker (Apple clang++ on darwin so it finds the SDK frameworks).
  compiler: string
  // The host keystore backend source.
  backend: string
  // 'objc++' (darwin .mm), or 'c' (linux/win .c) — picks the compile frontend.
  backendLang: 'objc++' | 'c'
  // Extra flags every compile gets (e.g. -fPIC, -fobjc-arc).
  compileFlags: string[]
  // Flags appended to the final link.
  linkFlags: string[]
}

/**
 * Run `pkg-config <args>` and return the split tokens, or throw with a clear
 * message naming the missing package so a libsecret-less host fails loudly.
 */
export function pkgConfig(args: readonly string[]): string[] {
  const r = spawnSync('pkg-config', args, { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(
      `pkg-config ${args.join(' ')} failed — is libsecret-1-dev installed? ` +
        (r.stderr?.trim() ?? ''),
    )
  }
  return r.stdout.trim().split(/\s+/u).filter(Boolean)
}

/**
 * Resolve the per-host compiler, backend, and flags.
 */
export function resolvePlatformBuild(
  platform: NodeJS.Platform,
  mode: string,
): PlatformBuild {
  const strip = mode === 'prod' ? ['-Wl,-S'] : []
  if (platform === 'darwin') {
    return {
      compiler: '/usr/bin/clang++',
      backend: path.join(keystoreDir, 'keystore_macos.mm'),
      backendLang: 'objc++',
      compileFlags: ['-fobjc-arc'],
      linkFlags: [
        '-undefined',
        'dynamic_lookup',
        ...strip,
        '-framework',
        'Foundation',
        '-framework',
        'Security',
        '-framework',
        'LocalAuthentication',
      ],
    }
  }
  if (platform === 'linux') {
    return {
      compiler: 'c++',
      backend: path.join(keystoreDir, 'keystore_linux.c'),
      backendLang: 'c',
      compileFlags: ['-fPIC', ...pkgConfig(['--cflags', 'libsecret-1'])],
      // N-API symbols stay undefined and resolve at dlopen from the host Node.
      linkFlags: ['-Wl,-s', ...pkgConfig(['--libs', 'libsecret-1'])],
    }
  }
  if (platform === 'win32') {
    // A Windows DLL cannot carry undefined symbols, so the N-API imports must
    // resolve against Node's import library (node.lib ships next to node.exe).
    const nodeLib = path.join(path.dirname(process.execPath), 'node.lib')
    return {
      compiler: 'clang++',
      backend: path.join(keystoreDir, 'keystore_win.c'),
      backendLang: 'c',
      compileFlags: [],
      linkFlags: ['-ladvapi32', nodeLib],
    }
  }
  throw new Error(
    `keychain-addon-builder: unsupported platform '${platform}' — ` +
      `expected darwin, linux, or win32.`,
  )
}

async function main() {
  const nodeInclude = path.join(
    path.dirname(path.dirname(process.execPath)),
    'include',
    'node',
  )
  if (!existsSync(path.join(nodeInclude, 'node_api.h'))) {
    throw new Error(`node_api.h not found under ${nodeInclude}.`)
  }

  const mode = getEnvValue('BUILD_MODE') ?? (getEnvValue('CI') ? 'prod' : 'dev')
  const platformArch = `${process.platform}-${process.arch}`
  const outDir = getKeychainAddonOutDir(mode, platformArch)
  await mkdir(outDir, { recursive: true })
  const outPath = getKeychainAddonBinaryPath(mode, platformArch)

  const build = resolvePlatformBuild(process.platform, mode)
  const optimize = mode === 'prod' ? '-O2' : '-O0'
  const profileFlag = `-fprofile-instr-generate=${getEnvValue('SOCKEYE_COVERAGE_PROFILE_FILE') ?? getDefaultNativeProfilePattern(outDir)}`
  const coverage =
    mode === 'coverage' ? [profileFlag, '-fcoverage-mapping'] : []
  const includes = [`-I${nodeInclude}`, `-I${KEYSTORE_SOURCE_DIR}`]
  const shimObj = path.join(outDir, 'keychain_napi.o')
  const backendObj = path.join(outDir, 'keystore_backend.o')

  logger.info(`Compiling keychain.node sources (${mode}, ${platformArch})…`)
  // The shim is C++. execBuildCommand throws on a non-zero exit.
  execBuildCommand(
    build.compiler,
    [
      '-c',
      optimize,
      ...coverage,
      '-std=c++17',
      ...build.compileFlags,
      ...includes,
      shim,
      '-o',
      shimObj,
    ],
    packageRoot,
  )
  // The backend: ObjC++ stays under clang++; C compiles with `-x c` so it isn't
  // miscompiled as C++.
  execBuildCommand(
    build.compiler,
    [
      '-c',
      optimize,
      ...coverage,
      ...(build.backendLang === 'objc++' ? ['-std=c++17'] : ['-x', 'c']),
      ...build.compileFlags,
      ...includes,
      build.backend,
      '-o',
      backendObj,
    ],
    packageRoot,
  )

  logger.info(`Linking keychain.node…`)
  execBuildCommand(
    build.compiler,
    [
      '-shared',
      shimObj,
      backendObj,
      ...(mode === 'coverage' ? [profileFlag] : []),
      ...build.linkFlags,
      '-o',
      outPath,
    ],
    packageRoot,
  )

  if (!existsSync(outPath)) {
    throw new Error(`Expected ${outPath} after link.`)
  }
  const stats = await stat(outPath)
  logger.success(`Built keychain.node: ${outPath} (${stats.size} bytes)`)
}

main().catch(e => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
