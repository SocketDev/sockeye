#!/usr/bin/env node
import {
  getScriptLogger,
  scriptStdio,
} from '../fleet/process/script-output.mts'
/**
 * @file Build and run the bounded native input-policy fuzz target. The default
 *   one-minute budget is long enough for a local gate and short enough to run
 *   routinely; release candidates can raise SOCKEYE_FUZZ_SECONDS.
 */

import process from 'node:process'
import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/main/run.mts'
import type { ScriptMeta } from '../fleet/process/main/run.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import { getCmakeBuildDir, getOutputDir } from './paths.mts'

export const SCRIPT_META: ScriptMeta = {
  describe: 'Build and run the bounded native input-policy fuzz target.',
  help: 'Usage: pnpm run fuzz\nEnvironment: SOCKEYE_FUZZ_SECONDS sets the positive runtime budget in seconds (default: 60).',
  json: 'result',
}

const logger = getScriptLogger()
const platformArch = `${process.platform}-${process.arch}`
const mode = 'fuzz'

async function run(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv | undefined,
): Promise<void> {
  const result = await spawn(command, args, {
    cwd: REPO_ROOT,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: scriptStdio('inherit'),
  })
  if (result.code !== 0) {
    throw new Error(`${command} failed with exit code ${result.code}`)
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Sockeye fuzzing currently requires its macOS toolchain')
  }
  const secondsText = getEnvValue('SOCKEYE_FUZZ_SECONDS') ?? '60'
  if (!/^\d+$/u.test(secondsText) || Number(secondsText) < 1) {
    throw new Error('SOCKEYE_FUZZ_SECONDS must be a positive integer')
  }

  const buildDir = getCmakeBuildDir(mode, platformArch)
  const outputDir = getOutputDir(mode, platformArch)
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(outputDir, { recursive: true })

  const brew = await spawn('brew', ['--prefix', 'llvm'], {
    cwd: REPO_ROOT,
  })
  const llvmPrefix = (brew.stdout ?? '').trim()
  if (brew.code !== 0 || llvmPrefix.length === 0) {
    throw new Error(
      'Homebrew LLVM is required because Apple Clang does not ship libFuzzer',
    )
  }
  const compiler = path.join(llvmPrefix, 'bin', 'clang++')
  await run('cmake', [
    '-S',
    REPO_ROOT,
    '-B',
    buildDir,
    `-DCMAKE_CXX_COMPILER=${compiler}`,
    `-DCMAKE_OBJCXX_COMPILER=${compiler}`,
    `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${outputDir}`,
  ])
  await run('cmake', [
    '--build',
    buildDir,
    '--target',
    'sockeye-input-policy-fuzz',
    '--parallel',
  ])
  const configuredOutput = path.join(outputDir, 'sockeye-input-policy-fuzz')
  const defaultOutput = path.join(buildDir, 'sockeye-input-policy-fuzz')
  const fuzzBinary = existsSync(configuredOutput)
    ? configuredOutput
    : defaultOutput
  await run(fuzzBinary, [
    `-max_total_time=${secondsText}`,
    '-print_final_stats=1',
  ])
  logger.success(`Native fuzz gate passed its ${secondsText}s budget`)
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
