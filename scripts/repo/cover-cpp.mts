#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import { parseArgs } from 'node:util'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { runMain } from '../fleet/process/main/run.mts'
import type { ScriptMeta } from '../fleet/process/main/run.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import {
  getScriptArgs,
  writeScriptStdout,
} from '../fleet/process/script-output.mts'
import {
  getNativeCoverageReceiptPath,
  getNativeProfilePattern,
  getOutputDir,
  REPO_ROOT,
} from './paths.mts'
import { ensureLlvmCoverageTools } from '../fleet/cover/llvm-toolchain.mts'
import {
  createLlvmCoverageManifest,
  parseLlvmCoverageManifest,
} from '../fleet/cover/llvm-manifest.mts'
import { exportLlvmCoverage } from '../fleet/cover/llvm-report.mts'
import { getKeychainAddonBinaryPath } from '../../packages/keychain-addon-builder/scripts/paths.mts'
import {
  NATIVE_COVERAGE_BINARIES,
  nativeTranslationUnits,
  nativeVitestArguments,
  nativeVitestEnvironment,
  readNativeTestCounts,
  validateNativeCoverageRoots,
} from './native-coverage.mts'

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Collect Clang source coverage through noninteractive native Vitest tests.',
  help: 'Usage: pnpm run cover:cpp --phase prepare|execute|report --manifest PATH --scratch-dir PATH --path ROOT (repeat)',
  json: 'result',
}
export interface NativeConfig {
  phase: string
  manifest: string
  scratch: string
  roots: string[]
}
export function parseNativeCoverageArgs(args: string[]): NativeConfig {
  const { values } = parseArgs({
    args,
    options: {
      phase: { type: 'string' },
      manifest: { type: 'string' },
      'scratch-dir': { type: 'string' },
      path: { type: 'string', multiple: true },
    },
    strict: true,
  })
  if (
    !values.phase ||
    !['prepare', 'execute', 'report'].includes(values.phase) ||
    !values.manifest ||
    !path.isAbsolute(values.manifest) ||
    !values['scratch-dir'] ||
    !path.isAbsolute(values['scratch-dir'])
  ) {
    throw new Error(
      'Native coverage requires a phase and absolute manifest/scratch paths',
    )
  }
  const roots = values.path ?? []
  validateNativeCoverageRoots(roots)
  return {
    phase: values.phase,
    manifest: values.manifest,
    scratch: values['scratch-dir'],
    roots,
  }
}
async function nativeCommand(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv | undefined,
): Promise<string> {
  const result = await spawn(command, args, {
    cwd: REPO_ROOT,
    env,
    stdio: 'pipe',
  })
  if (result.code !== 0) {
    throw new Error(
      `Native coverage command failed: ${command} (${result.code}): ${result.stderr ?? ''}`,
    )
  }
  return result.stdout ?? ''
}
function nativeFiles(config: NativeConfig) {
  const opts = { __proto__: null, ...config } as typeof config
  return {
    __proto__: null,
    state: path.join(opts.scratch, 'sockeye-native-state.json'),
    merged: path.join(opts.scratch, 'sockeye-native.profdata'),
    inputs: path.join(opts.scratch, 'sockeye-native-inputs.json'),
  }
}
function readProfileDirectory(config: NativeConfig): string {
  const opts = { __proto__: null, ...config } as typeof config
  const state: unknown = JSON.parse(
    readFileSync(nativeFiles(config).state, 'utf8'),
  )
  if (
    typeof state !== 'object' ||
    state === null ||
    !('profiles' in state) ||
    typeof state.profiles !== 'string' ||
    path.dirname(state.profiles) !== opts.scratch ||
    !path.basename(state.profiles).startsWith('sockeye-profiles-')
  ) {
    throw new Error('Native coverage preparation state is invalid')
  }
  return state.profiles
}
function nativeCoverageObjects(): string[] {
  const platformArch = `${process.platform}-${process.arch}`
  return [
    ...NATIVE_COVERAGE_BINARIES.map(name =>
      path.join(getOutputDir('coverage', platformArch), name),
    ),
    getKeychainAddonBinaryPath('coverage', platformArch),
  ]
}
function nativeCoverageRoots(config: NativeConfig) {
  return config.roots.map(root => ({
    __proto__: null,
    root,
    requiredSources: nativeTranslationUnits(path.resolve(REPO_ROOT, root)),
  }))
}
export async function prepareNativeCoverage(
  config: NativeConfig,
): Promise<void> {
  const opts = { __proto__: null, ...config } as typeof config
  const tools = await ensureLlvmCoverageTools(REPO_ROOT)
  mkdirSync(opts.scratch, { recursive: true })
  const profiles = path.join(
    opts.scratch,
    `sockeye-profiles-${crypto.randomUUID()}`,
  )
  mkdirSync(profiles)
  writeFileSync(nativeFiles(config).state, JSON.stringify({ profiles }))
  await nativeCommand(process.execPath, ['scripts/repo/build.mts'], {
    ...process.env,
    BUILD_MODE: 'coverage',
    SOCKEYE_COVERAGE_PROFILE_FILE: getNativeProfilePattern(profiles),
  })
  writeFileSync(
    nativeFiles(config).inputs,
    JSON.stringify(
      createLlvmCoverageManifest({
        toolchainVersion: tools.version,
        profileDirectory: profiles,
        objects: nativeCoverageObjects(),
        sources: nativeCoverageRoots(config).flatMap(
          root => root.requiredSources,
        ),
      }),
    ),
  )
  const common = [
    '--manifest',
    opts.manifest,
    '--scratch-dir',
    opts.scratch,
    ...opts.roots.flatMap(root => ['--path', root]),
  ]
  writeFileSync(
    opts.manifest,
    JSON.stringify({
      version: 1,
      executors: [
        {
          command: process.execPath,
          args: ['scripts/repo/cover-cpp.mts', '--phase', 'execute', ...common],
          cwd: REPO_ROOT,
          lane: 'slow',
        },
      ],
      reports: opts.roots.map((root, index) => ({
        __proto__: null,
        root,
        path: path.join(opts.scratch, `sockeye-native-${index}.lcov`),
      })),
    }),
  )
}
export async function executeNativeCoverage(
  config: NativeConfig,
): Promise<void> {
  const profiles = readProfileDirectory(config)
  await nativeCommand(
    process.execPath,
    nativeVitestArguments(getNativeCoverageReceiptPath(profiles)),
    nativeVitestEnvironment(process.env, getNativeProfilePattern(profiles)),
  )
  const counts = readNativeTestCounts(
    readFileSync(
      getNativeCoverageReceiptPath(readProfileDirectory(config)),
      'utf8',
    ),
  )
  writeScriptStdout(
    `Native Vitest: ${counts.failed} tests failed out of ${counts.total}\n`,
  )
}
export async function reportNativeCoverage(
  config: NativeConfig,
): Promise<void> {
  const opts = { __proto__: null, ...config } as typeof config
  readNativeTestCounts(
    readFileSync(
      getNativeCoverageReceiptPath(readProfileDirectory(config)),
      'utf8',
    ),
  )
  const profileDirectory = readProfileDirectory(config)
  const profiles = readdirSync(profileDirectory)
    .filter(name => name.endsWith('.profraw'))
    .map(name => path.join(profileDirectory, name))
  if (!profiles.length) {
    throw new Error('Native coverage has no instrumented execution profiles')
  }
  const tools = await ensureLlvmCoverageTools(REPO_ROOT)
  const reports = await exportLlvmCoverage({
    tools,
    manifest: parseLlvmCoverageManifest(
      readFileSync(nativeFiles(config).inputs, 'utf8'),
    ),
    repoRoot: REPO_ROOT,
    profiles,
    objects: nativeCoverageObjects(),
    mergedProfile: nativeFiles(config).merged,
    roots: nativeCoverageRoots(config),
  })
  const rootReports = opts.roots.map(root => {
    const report = reports.get(root)
    if (report === undefined) {
      throw new Error(
        `Native coverage report is incomplete. Where: ${root}. Saw no exporter output; wanted one LCOV report per configured root. Fix: regenerate every configured production root.`,
      )
    }
    return report
  })
  for (const [index, report] of rootReports.entries()) {
    writeFileSync(
      path.join(opts.scratch, `sockeye-native-${index}.lcov`),
      report,
    )
  }
}
async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      'Sockeye native coverage requires the macOS production toolchain',
    )
  }
  const config = parseNativeCoverageArgs(getScriptArgs())
  if (config.phase === 'prepare') {
    await prepareNativeCoverage(config)
  } else if (config.phase === 'execute') {
    await executeNativeCoverage(config)
  } else {
    await reportNativeCoverage(config)
  }
}
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
