#!/usr/bin/env node
import {
  getScriptLogger,
  scriptStdio,
} from '../fleet/process/script-output.mts'
/**
 * @file Configure and build the host Sockeye executable with CMake.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import process from 'node:process'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/main/run.mts'
import type { ScriptMeta } from '../fleet/process/main/run.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import { ensureNativeCoverageToolchain } from './native-toolchain.mts'
import { resolveMacosSdkPath } from './paths/macos-sdk.mts'
import {
  getBinaryPath,
  getBuildMode,
  getBuildModeArgs,
  getCmakeBuildDir,
  getDefaultNativeProfilePattern,
  getNodeHeaderDirectory,
  getOutputDir,
} from './paths.mts'

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Build the Sockeye executable and keychain addon with the macOS toolchain.',
  help: 'Usage: pnpm run build [--dev | --prod]\nEnvironment: BUILD_MODE selects the default mode; RELEASE_VERSION overrides the embedded version; SOCKEYE_TARGET_ARCH selects arm64 or x64.',
  json: 'result',
}

const logger = getScriptLogger()

interface BuildToolchain {
  readonly compilerArgs: string[]
  readonly sdk: string
}

async function run(command: string, args: string[]): Promise<void> {
  const result = await spawn(command, args, {
    cwd: REPO_ROOT,
    stdio: scriptStdio('inherit'),
  })
  if (result.code !== 0) {
    throw new Error(`${command} failed with exit code ${result.code}`)
  }
}

async function getBuildToolchain(mode: string): Promise<BuildToolchain> {
  if (mode !== 'coverage') {
    return { compilerArgs: [], sdk: await resolveMacosSdkPath() }
  }
  const toolchain = await ensureNativeCoverageToolchain()
  return {
    compilerArgs: [
      '--fresh',
      `-DCMAKE_CXX_COMPILER=${toolchain.clangxx}`,
      `-DCMAKE_OBJCXX_COMPILER=${toolchain.clangxx}`,
      `-DFLEET_LLVM_COVERAGE_VERSION=${toolchain.version}`,
    ],
    sdk: toolchain.sdk,
  }
}

export async function buildSockeye(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Sockeye build refused on ${process.platform}; the current release contract requires macOS Touch ID`,
    )
  }
  const mode = getBuildMode()
  const sanitizer =
    mode === 'asan' ? 'address' : mode === 'ubsan' ? 'undefined' : 'none'
  const targetArch = getEnvValue('SOCKEYE_TARGET_ARCH') ?? process.arch
  if (targetArch !== 'arm64' && targetArch !== 'x64') {
    throw new Error(
      `Build architecture rejected at SOCKEYE_TARGET_ARCH: saw ${targetArch}; expected arm64 or x64.`,
    )
  }
  const platformArch = `${process.platform}-${targetArch}`
  const cmakeBuildDir = getCmakeBuildDir(mode, platformArch)
  const outputDir = getOutputDir(mode, platformArch)
  const packageJson: { version: string } = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  )
  const version = getEnvValue('RELEASE_VERSION') ?? packageJson.version
  const buildType = mode === 'prod' ? 'Release' : 'Debug'
  const architecture = targetArch === 'arm64' ? 'arm64' : 'x86_64'
  const toolchain = await getBuildToolchain(mode)

  mkdirSync(cmakeBuildDir, { recursive: true })
  mkdirSync(outputDir, { recursive: true })
  logger.info(`Building Sockeye ${version} (${mode}, ${platformArch})…`)
  await run('cmake', [
    ...toolchain.compilerArgs,
    '-S',
    REPO_ROOT,
    '-B',
    cmakeBuildDir,
    `-DCMAKE_BUILD_TYPE=${buildType}`,
    '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
    `-DCMAKE_OSX_SYSROOT=${toolchain.sdk}`,
    `-DCMAKE_OSX_ARCHITECTURES=${architecture}`,
    `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${outputDir}`,
    `-DSOCKEYE_VERSION=${version}`,
    `-DSOCKEYE_NODE_INCLUDE=${getNodeHeaderDirectory()}`,
    `-DSOCKEYE_SANITIZER=${sanitizer}`,
    `-DSOCKEYE_COVERAGE=${mode === 'coverage' ? 'ON' : 'OFF'}`,
    `-DSOCKEYE_COVERAGE_PROFILE_FILE=${getEnvValue('SOCKEYE_COVERAGE_PROFILE_FILE') ?? getDefaultNativeProfilePattern(cmakeBuildDir)}`,
  ])
  await run('cmake', ['--build', cmakeBuildDir, '--parallel'])

  const binaryPath = getBinaryPath(mode, platformArch)
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Sockeye build completed without the expected binary at ${binaryPath}`,
    )
  }
  const metadata = await stat(binaryPath)
  logger.success(`Built ${binaryPath} (${metadata.size} bytes)`)

  logger.info('Building the keychain addon…')
  await run('node', [
    'packages/keychain-addon-builder/scripts/build.mts',
    ...getBuildModeArgs(mode),
  ])
}

if (isMainModule(import.meta.url)) {
  runMain(buildSockeye, SCRIPT_META)
}
