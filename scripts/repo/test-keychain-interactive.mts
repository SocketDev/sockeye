import { scriptStdio } from '../fleet/process/script-output.mts'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'

import { REPO_ROOT } from '../fleet/paths.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import { isKeychainEvidence, KEYCHAIN_CASES } from './keychain-evidence.mts'
import {
  getNativeTestBinaryPath,
  KEYCHAIN_INTERACTIVE_SUITE,
} from './paths.mts'
import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Collect attended Keychain observations on a dedicated test Mac; never runs in CI.',
  help: 'Usage: pnpm run test:keychain:interactive\nSet SOCKEYE_KEYCHAIN_EVIDENCE_FILE to a new external JSON path, SOCKEYE_KEYCHAIN_SOURCE to the source commit, and SOCKEYE_KEYCHAIN_SIGNING_CLASS to unsigned, ad-hoc, or developer-id. Read docs/keychain-validation.md first.',
  json: 'result',
}

export function keychainAttendanceAllowed(
  environment: NodeJS.ProcessEnv,
  platform: string,
  config: { foreground: boolean },
): boolean {
  const { foreground } = { __proto__: null, ...config } as typeof config
  return (
    platform === 'darwin' && !Object.hasOwn(environment, 'CI') && foreground
  )
}

export function keychainSuiteAllowed(
  environment: NodeJS.ProcessEnv,
  platform: string,
  config: { foreground: boolean },
): boolean {
  return (
    environment['SOCKEYE_INTERACTIVE_TESTS'] === '1' &&
    keychainAttendanceAllowed(environment, platform, config)
  )
}

export function keychainForegroundTerminal(): boolean {
  if (process.platform !== 'darwin' || Object.hasOwn(process.env, 'CI')) {
    return false
  }
  const result = spawnSync(
    getNativeTestBinaryPath('sockeye-keychain-observer'),
    ['--foreground-terminal'],
    { stdio: scriptStdio('inherit') },
  )
  return !result.error && result.status === 0
}

export function keychainCollectionPassed(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === KEYCHAIN_CASES.length &&
    KEYCHAIN_CASES.every(
      testCase =>
        value.filter(
          item =>
            isKeychainEvidence(item) &&
            item.testCase === testCase &&
            item.status === 'passed',
        ).length === 1,
    )
  )
}

export async function runKeychainInteractive(): Promise<number> {
  if (
    !keychainAttendanceAllowed(process.env, process.platform, {
      foreground: process.stdin.isTTY,
    }) ||
    !keychainForegroundTerminal()
  ) {
    return 1
  }
  const evidenceFile = getEnvValue('SOCKEYE_KEYCHAIN_EVIDENCE_FILE')
  if (!evidenceFile || existsSync(evidenceFile)) {
    return 1
  }
  const terminal = createInterface({
    input: process.stdin,
    output: process.argv.includes('--json') ? process.stderr : process.stdout,
  })
  try {
    if (
      (await terminal.question(
        'Dedicated test Mac only. Type ATTENDED to collect manual observations: ',
      )) !== 'ATTENDED'
    ) {
      return 1
    }
  } finally {
    terminal.close()
  }
  const result = spawnSync(
    process.execPath,
    ['scripts/fleet/test.mts', KEYCHAIN_INTERACTIVE_SUITE],
    {
      cwd: REPO_ROOT,
      stdio: scriptStdio('inherit'),
      env: { ...process.env, SOCKEYE_INTERACTIVE_TESTS: '1' },
    },
  )
  if (result.error || result.status !== 0) {
    return 1
  }
  try {
    return keychainCollectionPassed(
      JSON.parse(readFileSync(evidenceFile, 'utf8')),
    )
      ? 0
      : 1
  } catch {
    return 1
  }
}

if (isMainModule(import.meta.url)) {
  runMain(runKeychainInteractive, SCRIPT_META)
}
