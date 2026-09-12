#!/usr/bin/env node
import {
  getScriptArgs,
  getScriptLogger,
} from '../fleet/process/script-output.mts'
/**
 * @file Verify the exact archives (or binaries) that will be uploaded to a
 *   release (release-checklist steps 5–6). Everything here runs for real:
 *   Strict codesign verification and online notarization checks run against
 *   every Sockeye binary found, alongside an archive listing and SHA-256
 *   checksums. The results print as evidence rows in the release checklist's
 *   table format so the recorded-evidence row is generated, not typed. Exits
 *   non-zero if any check fails — a local ad-hoc build passes codesign but
 *   fails the online notarization check. App bundles require spctl assessment.
 */

import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import { BINARY_NAME, getBinaryPath, getBuildMode } from './paths.mts'

const logger = getScriptLogger()

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Verify signatures, notarization, and checksums of Sockeye release files.',
  help: 'Usage: pnpm run verify-release [archive-or-binary…]\n\nRequires macOS. Targets default to the built binary for the current mode. Verification checks signatures and online notarization tickets for Sockeye CLI binaries and prints release evidence.',
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

async function runCheck(
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

async function sha256(filePath: string): Promise<string> {
  return crypto
    .createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')
}

async function findBinaries(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name === BINARY_NAME)
    .map(entry => path.join(entry.parentPath, entry.name))
}

export async function verifyReleaseBinary(
  binaryPath: string,
  label: string,
  rows: EvidenceRow[],
): Promise<boolean> {
  const codesign = await runCheck('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    binaryPath,
  ])
  rows.push({
    evidence: `\`${label}\`: ${codesign.passed ? 'passed --verify --deep --strict' : `FAILED (${codesign.detail})`}`,
    item: 'Codesign',
  })
  const isApplication = path.extname(binaryPath).toLowerCase() === '.app'
  const assessment = isApplication
    ? await runCheck('/usr/sbin/spctl', [
        '--assess',
        '--type',
        'execute',
        '--verbose',
        binaryPath,
      ])
    : await runCheck('/usr/bin/codesign', [
        '--verify',
        '--strict',
        '--check-notarization',
        '--verbose=2',
        binaryPath,
      ])
  rows.push({
    evidence: `\`${label}\`: ${assessment.passed ? (isApplication ? 'accepted by spctl --assess' : 'passed codesign --check-notarization') : `REJECTED (${assessment.detail})`}`,
    item: isApplication ? 'Gatekeeper' : 'Notarization',
  })
  return codesign.passed && assessment.passed
}

async function verifyArchive(
  archive: string,
  rows: EvidenceRow[],
): Promise<boolean> {
  const name = path.basename(archive)
  const extension = path.extname(archive).toLowerCase()
  const isTarball = archive.endsWith('.tar.gz') || extension === '.tgz'
  const listing = isTarball
    ? await runCheck('/usr/bin/tar', ['-tzf', archive])
    : await runCheck('/usr/bin/unzip', ['-l', archive])
  if (!listing.passed) {
    rows.push({
      evidence: `\`${name}\`: unreadable archive (${listing.detail})`,
      item: 'Archive',
    })
    return false
  }
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'sockeye-verify-'))
  const extract = isTarball
    ? await runCheck('/usr/bin/tar', ['-xzf', archive, '-C', scratch])
    : await runCheck('/usr/bin/ditto', ['-x', '-k', archive, scratch])
  if (!extract.passed) {
    rows.push({
      evidence: `\`${name}\`: extraction failed (${extract.detail})`,
      item: 'Archive',
    })
    return false
  }
  const binaries = await findBinaries(scratch)
  const entryCount = (await readdir(scratch, { recursive: true })).length
  rows.push({
    evidence: `\`${name}\`: ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}, ${binaries.length} \`${BINARY_NAME}\` ${binaries.length === 1 ? 'binary' : 'binaries'}`,
    item: 'Archive',
  })
  if (binaries.length === 0) {
    rows.push({
      evidence: `\`${name}\`: FAILED — no \`${BINARY_NAME}\` binary inside`,
      item: 'Codesign',
    })
    return false
  }
  let passed = true
  for (const binary of binaries) {
    const label = `${name}!${path.relative(scratch, binary)}`
    passed = (await verifyReleaseBinary(binary, label, rows)) && passed
  }
  return passed
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Sockeye release verification refused on ${process.platform}; codesign and spctl require macOS`,
    )
  }
  const targets =
    getScriptArgs().length > 0
      ? getScriptArgs()
      : [getBinaryPath(getBuildMode(), `${process.platform}-${process.arch}`)]
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
      evidence: `\`node scripts/repo/verify-release.mts ${targets.join(' ')}\``,
      item: 'Command',
    },
  ]

  let passed = true
  for (const target of targets) {
    const extension = path.extname(target).toLowerCase()
    const isArchive =
      ['.tgz', '.zip'].includes(extension) || target.endsWith('.tar.gz')
    if (isArchive) {
      passed = (await verifyArchive(target, rows)) && passed
    } else {
      const metadata = await stat(target)
      rows.push({
        evidence: `\`${path.basename(target)}\`: ${metadata.size} bytes`,
        item: 'Binary',
      })
      passed =
        (await verifyReleaseBinary(target, path.basename(target), rows)) &&
        passed
    }
    rows.push({
      evidence: `\`${path.basename(target)}\` \`${await sha256(target)}\``,
      item: 'SHA-256',
    })
  }
  rows.push({ evidence: passed ? 'Passed' : 'FAILED', item: 'Result' })

  logger.log('')
  logger.log(renderEvidenceTable(rows))
  logger.log('')
  if (passed) {
    logger.success(
      'All verification checks passed — paste the rows above into docs/release-checklist.md',
    )
  } else {
    throw new Error('One or more verification checks failed; see the table')
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
