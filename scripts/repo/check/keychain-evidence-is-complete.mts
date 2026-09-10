import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'
import type { ScriptMeta } from '../../fleet/process/run-main.mts'
import { ordinaryTestEnvironment } from '../test.mts'
import { keychainSuiteAllowed } from '../test-keychain-interactive.mts'
import {
  isKeychainEvidence,
  isKeychainRecord,
  KEYCHAIN_CASES,
  readKeychainArtifact,
  validateKeychainEvidence,
} from '../keychain-evidence.mts'

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Validate Keychain evidence tooling, or strictly verify attended release evidence against both architecture artifacts.',
  help: 'Usage: pnpm run check:keychain-evidence [<evidence-directory> --binary <arm64-path> --binary <x64-path> --source <commit>]\nNo arguments validates tooling only; it does not validate attended evidence.',
}

export function checkKeychainTooling(root: string): string[] {
  const issues: string[] = []
  const runbook = readFileSync(
    path.join(root, 'docs/keychain-validation.md'),
    'utf8',
  )
  for (const testCase of KEYCHAIN_CASES) {
    if (!runbook.includes(`\`${testCase}\``)) {
      issues.push(`undocumented:${testCase}`)
    }
  }
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  )
  const scripts =
    isKeychainRecord(manifest) && isKeychainRecord(manifest['scripts'])
      ? manifest['scripts']
      : {}
  if (
    scripts['test:keychain:interactive'] !==
    'node scripts/repo/test-keychain-interactive.mts'
  ) {
    issues.push('interactive-entry')
  }
  if (
    scripts['check:keychain-evidence'] !==
    'node scripts/repo/check/keychain-evidence-is-complete.mts'
  ) {
    issues.push('evidence-entry')
  }
  if (scripts['test'] !== 'node scripts/repo/test.mts') {
    issues.push('ordinary-entry')
  }
  if (isKeychainEvidence({})) {
    issues.push('schema')
  }
  const ordinary = ordinaryTestEnvironment({ SOCKEYE_INTERACTIVE_TESTS: '1' })
  if (keychainSuiteAllowed(ordinary, 'darwin', { foreground: true })) {
    issues.push('ordinary-attendance')
  }
  if (
    keychainSuiteAllowed({ SOCKEYE_INTERACTIVE_TESTS: '1', CI: '' }, 'darwin', {
      foreground: true,
    })
  ) {
    issues.push('ci-attendance')
  }
  return issues
}

export function checkKeychainEvidenceArguments(args: string[]): string[] {
  if (args[0] === '--') {
    return checkKeychainEvidenceArguments(args.slice(1))
  }
  if (
    args.length !== 7 ||
    args[1] !== '--binary' ||
    args[3] !== '--binary' ||
    args[5] !== '--source'
  ) {
    return ['arguments']
  }
  const [directory, , armBinary, , intelBinary, , source] = args
  if (!directory || !armBinary || !intelBinary || !source) {
    return ['arguments']
  }
  const artifacts = [
    readKeychainArtifact(armBinary),
    readKeychainArtifact(intelBinary),
  ]
  const values: unknown[] = []
  for (const filename of readdirSync(directory)) {
    if (!filename.endsWith('.json')) {
      continue
    }
    const value: unknown = JSON.parse(
      readFileSync(path.join(directory, filename), 'utf8'),
    )
    if (!Array.isArray(value)) {
      return ['invalid-document']
    }
    values.push(...value)
  }
  return validateKeychainEvidence(values, artifacts, source)
}

export function runKeychainEvidenceCheck(
  options: { args?: string[] | undefined } = {},
): number {
  const { args = process.argv.slice(2) } = options
  try {
    const issues = args.length
      ? checkKeychainEvidenceArguments(args)
      : checkKeychainTooling(REPO_ROOT)
    if (issues.length) {
      process.stderr.write(
        `Keychain validation failed at evidence gate: ${issues.length} issue(s), first ${issues[0]}. Complete the runbook and supply current artifacts.\n`,
      )
      return 1
    }
    process.stdout.write(
      args.length
        ? 'Attended evidence matches supplied artifacts and source.\n'
        : 'Keychain tooling checked; attended evidence remains unverified.\n',
    )
    return 0
  } catch {
    process.stderr.write(
      'Keychain validation failed at input: expected readable tooling or evidence and Mach-O binaries. Check paths and JSON documents.\n',
    )
    return 1
  }
}

if (isMainModule(import.meta.url)) {
  runMain(runKeychainEvidenceCheck, SCRIPT_META)
}
