import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { isJsonRequested, runMain } from '../../fleet/process/main/run.mts'
import type { ScriptMeta } from '../../fleet/process/main/run.mts'
import { ordinaryTestEnvironment } from '../test.mts'
import { keychainSuiteAllowed } from '../test-keychain-interactive.mts'
import {
  isKeychainEvidence,
  isKeychainRecord,
  KEYCHAIN_CASES,
  readKeychainArtifact,
  validateKeychainEvidence,
} from '../keychain-evidence.mts'
import { verifyReleaseBinary } from '../verify-release.mts'
import type { EvidenceRow } from '../verify-release.mts'

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Validate Keychain evidence tooling, or strictly verify attended release evidence against both architecture artifacts.',
  help: 'Usage: pnpm run check:keychain-evidence [<evidence-directory> --binary <arm64-path> --binary <x64-path> --source <commit>]\nNo arguments validates tooling only; it does not validate attended evidence.',
  json: 'result',
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

interface KeychainEvidenceCheckConfig {
  verifyBinary?:
    | ((binary: string, label: string, rows: EvidenceRow[]) => Promise<boolean>)
    | undefined
}

interface KeychainEvidenceInputs {
  armBinary: string
  directory: string
  intelBinary: string
  source: string
}

function keychainEvidenceInputs(
  args: string[],
): KeychainEvidenceInputs | undefined {
  if (
    args.length !== 7 ||
    args[1] !== '--binary' ||
    args[3] !== '--binary' ||
    args[5] !== '--source'
  ) {
    return undefined
  }
  const { 0: directory, 2: armBinary, 4: intelBinary, 6: source } = args
  return armBinary && directory && intelBinary && source
    ? ({
        __proto__: null,
        armBinary,
        directory,
        intelBinary,
        source,
      } as KeychainEvidenceInputs)
    : undefined
}

export async function checkKeychainEvidenceArguments(
  args: string[],
  options: KeychainEvidenceCheckConfig = {},
): Promise<string[]> {
  const config = { __proto__: null, ...options }
  if (args[0] === '--') {
    return checkKeychainEvidenceArguments(args.slice(1), config)
  }
  const inputs = keychainEvidenceInputs(args)
  if (!inputs) {
    return ['arguments']
  }
  const { armBinary, directory, intelBinary, source } = inputs
  const artifacts = [
    readKeychainArtifact(armBinary),
    readKeychainArtifact(intelBinary),
  ]
  const verifyBinary = config.verifyBinary ?? verifyReleaseBinary
  for (const binary of [armBinary, intelBinary]) {
    if (!(await verifyBinary(binary, path.basename(binary), []))) {
      return [`artifact-verification:${path.basename(binary)}`]
    }
  }
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

export async function runKeychainEvidenceCheck(
  options: { args?: string[] | undefined } = {},
): Promise<number> {
  const argv = options.args ?? process.argv.slice(2)
  const json = isJsonRequested(argv)
  const args = argv.filter(arg => arg !== '--json')
  try {
    const issues = args.length
      ? await checkKeychainEvidenceArguments(args)
      : checkKeychainTooling(REPO_ROOT)
    if (issues.length) {
      process.stderr.write(
        `Keychain validation failed at evidence gate: ${issues.length} issue(s), first ${issues[0]}. Complete the runbook and supply current artifacts.\n`,
      )
      return 1
    }
    const output = json ? process.stderr : process.stdout
    output.write(
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
