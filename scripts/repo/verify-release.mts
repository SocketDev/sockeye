#!/usr/bin/env node
import {
  getScriptArgs,
  getScriptLogger,
} from '../fleet/process/script-output.mts'
/**
 * @file Verify the exact Sockeye application archives shipped to users.
 */

import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import type { ScriptResult } from '../fleet/process/script-result.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import {
  BINARY_NAME,
  getBinaryPath,
  getBuildMode,
  releaseBundleDirectoryPath,
  releaseBundlePath,
  releaseBundlePaths,
  releaseChecksumPath,
} from './paths.mts'
import {
  RELEASE_DESIGNATED_REQUIREMENT,
  releaseArchiveEntriesAreValid,
  releaseArchiveMemberTypesAreValid,
  releaseChecksumMatches,
  releaseEntitlementsAreValid,
  validateReleaseBundleMetadata,
} from './release/bundle.mts'
import { verifyNotaryReceiptEvidence } from './release/verify-notary-receipt.mts'
import type { NotaryReceiptEvidence } from './release/verify-notary-receipt.mts'
export {
  RELEASE_APPLICATION_IDENTIFIER,
  releaseArchiveEntriesAreValid,
  releaseArchiveMemberTypesAreValid,
  releaseChecksumMatches,
  releaseEntitlementsAreValid,
  RELEASE_TEAM_IDENTIFIER,
} from './release/bundle.mts'

const logger = getScriptLogger()

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Verify signatures, notarization, and checksums of Sockeye release files.',
  help: 'Usage: pnpm run verify-release [--expected-version <version>] [--receipt <json> --submission <zip> --notary-log <json> --expected-source <sha> --expected-architecture <arch> --expected-run-id <id> --expected-run-attempt <attempt> --expected-repository <owner/repo> --expected-workflow-ref <ref>] [archive-or-binary…]\n\nRequires macOS. Targets default to the built binary for the current mode. Verification checks signatures, attached notarization tickets, release metadata, and checksums.',
  json: 'result',
}

export interface EvidenceRow {
  evidence: string
  item: string
}

export interface CheckOutcome {
  detail: string
  passed: boolean
}

export function renderEvidenceTable(rows: EvidenceRow[]): string {
  const width = Math.max(...rows.map(row => row.item.length), 'Item'.length)
  const lines = [
    `| ${'Item'.padEnd(width)} | Evidence |`,
    `| ${'-'.repeat(width)} | -------- |`,
  ]
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    lines.push(`| ${row.item.padEnd(width)} | ${row.evidence} |`)
  }
  return lines.join('\n')
}

export async function runCheck(
  command: string,
  args: string[],
): Promise<CheckOutcome> {
  const result = await spawn(command, args, { cwd: REPO_ROOT })
  const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    .trim()
    .split(/\r?\n/)
    .at(-1)
  return { detail: detail ?? '', passed: result.code === 0 }
}

export async function sha256(filePath: string): Promise<string> {
  return crypto.hash('sha256', await readFile(filePath))
}

export async function findBinaries(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name === BINARY_NAME)
    .map(entry => path.join(entry.parentPath, entry.name))
}

export async function archiveEntries(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries.map(entry =>
    normalizePath(path.relative(root, path.join(entry.parentPath, entry.name))),
  )
}

export async function archiveHasSymlink(root: string): Promise<boolean> {
  return (await readdir(root, { recursive: true, withFileTypes: true })).some(
    entry => entry.isSymbolicLink(),
  )
}

export async function validateReleaseApplication(
  binaryPath: string,
  expectedVersion: string | undefined,
): Promise<void> {
  if (path.extname(binaryPath) !== '.app') {
    return
  }
  await validateReleaseBundleMetadata(binaryPath, { expectedVersion })
}

export async function assessReleaseBinary(
  binaryPath: string,
): Promise<CheckOutcome> {
  const isApplication = path.extname(binaryPath).toLowerCase() === '.app'
  return isApplication
    ? runCheck('/usr/sbin/spctl', [
        '--assess',
        '--type',
        'execute',
        '--verbose',
        binaryPath,
      ])
    : runCheck('/usr/bin/codesign', [
        '--verify',
        '--strict',
        '--check-notarization',
        '--verbose=2',
        binaryPath,
      ])
}

export async function verifyReleaseBinary(
  binaryPath: string,
  label: string,
  rows: EvidenceRow[],
  options: { expectedVersion?: string | undefined } = {},
): Promise<boolean> {
  const { expectedVersion } = { __proto__: null, ...options } as typeof options
  const codesign = await runCheck('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    '-R',
    RELEASE_DESIGNATED_REQUIREMENT,
    binaryPath,
  ])
  rows.push({
    evidence: `\`${label}\`: ${codesign.passed ? 'passed --verify --deep --strict' : `FAILED (${codesign.detail})`}`,
    item: 'Codesign',
  })
  if (!codesign.passed) {
    return false
  }
  await validateReleaseApplication(binaryPath, expectedVersion)
  const entitlements = await spawn(
    '/usr/bin/codesign',
    ['--display', '--entitlements', ':-', binaryPath],
    { cwd: REPO_ROOT },
  )
  const entitlementPlist = `${entitlements.stdout ?? ''}\n${entitlements.stderr ?? ''}`
  const entitlementsPassed =
    entitlements.code === 0 && releaseEntitlementsAreValid(entitlementPlist)
  rows.push({
    evidence: `\`${label}\`: ${entitlementsPassed ? 'required application and team identifiers present' : 'FAILED - required release entitlements are missing or incorrect'}`,
    item: 'Entitlements',
  })
  const isApplication = path.extname(binaryPath).toLowerCase() === '.app'
  const assessment = await assessReleaseBinary(binaryPath)
  rows.push({
    evidence: `\`${label}\`: ${assessment.passed ? (isApplication ? 'accepted by spctl --assess' : 'passed codesign --check-notarization') : `REJECTED (${assessment.detail})`}`,
    item: isApplication ? 'Gatekeeper' : 'Notarization',
  })
  const staple = isApplication
    ? await runCheck('/usr/bin/xcrun', ['stapler', 'validate', binaryPath])
    : { detail: '', passed: true }
  if (isApplication) {
    rows.push({
      evidence: `\`${label}\`: ${staple.passed ? 'attached ticket validated' : `FAILED (${staple.detail})`}`,
      item: 'Staple',
    })
  }
  return [entitlementsPassed, assessment.passed, staple.passed].every(Boolean)
}

export async function verifyArchive(
  archive: string,
  rows: EvidenceRow[],
  expectedVersion: string | undefined,
): Promise<boolean> {
  const name = path.basename(archive)
  const checksumPath = releaseChecksumPath(archive)
  if (!existsSync(checksumPath)) {
    rows.push({
      evidence: `\`${name}\`: FAILED - checksum sidecar is missing`,
      item: 'SHA-256',
    })
    return false
  }
  const actualChecksum = await sha256(archive)
  if (
    !releaseChecksumMatches(
      await readFile(checksumPath, 'utf8'),
      actualChecksum,
      name,
    )
  ) {
    rows.push({
      evidence: `\`${name}\`: FAILED - checksum does not match its sidecar`,
      item: 'SHA-256',
    })
    return false
  }
  rows.push({
    evidence: `\`${name}\`: sidecar matches \`${actualChecksum}\``,
    item: 'SHA-256',
  })
  const listing = await spawn('/usr/bin/unzip', ['-Z1', archive], {
    cwd: REPO_ROOT,
  })
  if (listing.code !== 0) {
    rows.push({
      evidence: `\`${name}\`: unreadable archive (${listing.stderr ?? ''})`,
      item: 'Archive',
    })
    return false
  }
  const listedEntries = listing.stdout
    ? listing.stdout.split(/\r?\n/u).filter(Boolean)
    : []
  if (!releaseArchiveEntriesAreValid(listedEntries)) {
    rows.push({
      evidence: `\`${name}\`: FAILED - archive members differ from the release allowlist`,
      item: 'Archive',
    })
    return false
  }
  const metadata = await spawn('/usr/bin/zipinfo', ['-l', archive], {
    cwd: REPO_ROOT,
  })
  if (
    metadata.code !== 0 ||
    !releaseArchiveMemberTypesAreValid(
      listedEntries,
      `${metadata.stdout ?? ''}`,
    )
  ) {
    rows.push({
      evidence: `\`${name}\`: FAILED - archive contains an unsafe member type`,
      item: 'Archive',
    })
    return false
  }
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'sockeye-verify-'))
  try {
    const extract = await runCheck('/usr/bin/ditto', [
      '-x',
      '-k',
      '--norsrc',
      archive,
      scratch,
    ])
    if (!extract.passed) {
      rows.push({
        evidence: `\`${name}\`: extraction failed (${extract.detail})`,
        item: 'Archive',
      })
      return false
    }
    const entries = await archiveEntries(scratch)
    const binaries = await findBinaries(scratch)
    const bundle = releaseBundleDirectoryPath(scratch)
    const expected = releaseBundlePaths(bundle)
    const completeBundle = [
      releaseArchiveEntriesAreValid(entries),
      !(await archiveHasSymlink(scratch)),
      binaries.length === 1,
      binaries[0] === expected.binary,
      existsSync(expected.profile),
      existsSync(expected.info),
    ].every(Boolean)
    rows.push({
      evidence: `\`${name}\`: ${entries.length} entries, ${binaries.length} \`${BINARY_NAME}\` ${binaries.length === 1 ? 'binary' : 'binaries'}`,
      item: 'Archive',
    })
    if (!completeBundle) {
      rows.push({
        evidence: `\`${name}\`: FAILED - expected the provisioned Sockeye application bundle`,
        item: 'Archive',
      })
      return false
    }
    return await verifyReleaseBinary(
      bundle,
      `${name}!${path.relative(scratch, expected.binary)}`,
      rows,
      { expectedVersion },
    )
  } finally {
    await safeDelete(scratch)
  }
}

export async function verifyNotaryReceipt(
  evidence: NotaryReceiptEvidence,
  targets: readonly string[],
  rows: EvidenceRow[],
): Promise<boolean> {
  const passed = await verifyNotaryReceiptEvidence(
    evidence,
    targets.length === 1 ? targets[0] : undefined,
  )
  rows.push({
    evidence:
      evidence.receipt === undefined
        ? 'Not supplied'
        : passed
          ? 'Bound to archive, source, architecture, and workflow run'
          : 'FAILED',
    item: 'Receipt',
  })
  return passed
}

export async function main(): Promise<ScriptResult> {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Sockeye release verification refused on ${process.platform}; codesign and spctl require macOS`,
    )
  }
  const invocationArgs = getScriptArgs()
  const { positionals, values } = parseArgs({
    args: invocationArgs,
    options: {
      'expected-architecture': { type: 'string' },
      'expected-run-attempt': { type: 'string' },
      'expected-run-id': { type: 'string' },
      'expected-repository': { type: 'string' },
      'expected-source': { type: 'string' },
      'expected-workflow-ref': { type: 'string' },
      'expected-version': { type: 'string' },
      'notary-log': { type: 'string' },
      receipt: { type: 'string' },
      submission: { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  })
  const expectedVersion = values['expected-version']
  const targets =
    positionals.length > 0
      ? positionals
      : [
          releaseBundlePath(
            getBinaryPath(
              getBuildMode(),
              `${process.platform}-${process.arch}`,
            ),
          ),
        ]
  for (const target of targets) {
    if (!existsSync(target)) {
      throw new Error(
        `Nothing to verify at ${target}; pass the exact archives that will be uploaded`,
      )
    }
  }

  const head = await spawn('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
  const rows: EvidenceRow[] = [
    {
      evidence: `\`${(head.stdout ?? '').trim()}\``,
      item: 'Verifier revision',
    },
    {
      evidence: `\`node scripts/repo/verify-release.mts ${invocationArgs.join(' ')}\``,
      item: 'Command',
    },
  ]

  let passed = true
  for (const target of targets) {
    const extension = path.extname(target).toLowerCase()
    const isArchive = extension === '.zip'
    if (isArchive) {
      passed = (await verifyArchive(target, rows, expectedVersion)) && passed
    } else {
      if (extension !== '.app') {
        throw new Error(
          'Release verification requires the provisioned application bundle or its archive. Pass sockeye.app instead of its executable.',
        )
      }
      const metadata = await stat(target)
      rows.push({
        evidence: `\`${path.basename(target)}\`: ${metadata.size} bytes`,
        item: 'Binary',
      })
      passed =
        (await verifyReleaseBinary(target, path.basename(target), rows, {
          expectedVersion,
        })) && passed
    }
    if ((await stat(target)).isFile()) {
      rows.push({
        evidence: `\`${path.basename(target)}\` \`${await sha256(target)}\``,
        item: 'SHA-256',
      })
    }
  }
  passed =
    (await verifyNotaryReceipt(
      {
        expectedArchitecture: values['expected-architecture'],
        expectedRunAttempt: values['expected-run-attempt'],
        expectedRunId: values['expected-run-id'],
        expectedRepository: values['expected-repository'],
        expectedSource: values['expected-source'],
        expectedWorkflowRef: values['expected-workflow-ref'],
        log: values['notary-log'],
        receipt: values['receipt'],
        submission: values['submission'],
      },
      targets,
      rows,
    )) && passed
  rows.push({ evidence: passed ? 'Passed' : 'FAILED', item: 'Result' })

  logger.log('')
  logger.log(renderEvidenceTable(rows))
  logger.log('')
  if (passed) {
    logger.success(
      'All verification checks passed. Paste the rows above into docs/release-checklist.md.',
    )
  } else {
    throw new Error('One or more verification checks failed; see the table')
  }
  return {
    data: {
      expectedVersion,
      rows,
      targets,
    },
    exitCode: 0,
  }
}

if (isMainModule(import.meta.url)) {
  runMain(
    () =>
      main().catch((error: unknown) => {
        logger.fail(
          `Sockeye release verification failed: ${errorMessage(error)}`,
        )
        process.exitCode = 1
      }),
    SCRIPT_META,
  )
}
