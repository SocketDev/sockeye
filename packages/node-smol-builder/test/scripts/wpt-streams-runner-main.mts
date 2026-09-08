#!/usr/bin/env node
/**
 * WPT Streams runner entrypoint — orchestrates the full validation run.
 *
 * Imports the reusable runner primitives from wpt-streams-runner.mts and
 * drives the end-to-end pipeline (gather → validate → report). Split from
 * wpt-streams-runner.mts to keep each file under the 500-line soft cap.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from 'local-build-infra/lib/error-utils'

import { classifyResult } from './wpt-streams/classifier.mts'
import { reportWptResult, reportWptSummary } from './wpt-streams/report.mts'
import type { TestResult, UnexpectedFailure } from './wpt-streams/types.mts'
import {
  ensureWptStreams,
  EXPECTED_FAILURES,
  findTestFiles,
  parseArgs,
  resolveDefaultBinary,
  runTestFile,
  SKIP_FILES,
  WPT_DIR,
  WPT_SUBMODULE_DIR,
} from './wpt-streams-runner.mts'

const logger = getDefaultLogger()

async function main(): Promise<void> {
  const opts = parseArgs()
  // Fill the default dev binary when none was passed (async platform-arch
  // lookup, so it can't be a module-scope const).
  if (!opts.binary) {
    opts.binary = await resolveDefaultBinary()
  }

  logger.info('=== WPT Streams Validation ===')
  logger.error('')

  // Check binary
  if (!existsSync(opts.binary)) {
    logger.fail(`Binary not found: ${opts.binary}`)
    logger.log('')
    logger.log('Build the binary first:')
    logger.substep(
      'pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build',
    )
    process.exitCode = 1
    return
  }

  // Ensure WPT streams is on disk. The submodule's recorded SHA
  // (.gitmodules gitlink) is the version pointer; sparse-checkout =
  // streams/ in .gitmodules is honored by
  // scripts/git-partial-submodule.mts.
  await ensureWptStreams(opts.force)

  if (!existsSync(WPT_DIR)) {
    logger.fail('WPT streams directory not found after fetch')
    process.exitCode = 1
    return
  }

  // Find test files
  let testFiles = findTestFiles(WPT_DIR)

  // Apply filter
  if (opts.filter) {
    testFiles = testFiles.filter(f =>
      path.relative(WPT_DIR, f).includes(opts.filter),
    )
  }

  // Skip problematic files
  testFiles = testFiles.filter(f => {
    const rel = path.relative(WPT_DIR, f)
    return (
      !SKIP_FILES.has(rel) && ![...SKIP_FILES].some(skip => rel.endsWith(skip))
    )
  })

  logger.info(`Binary: ${opts.binary}`)
  logger.info(`Test files: ${testFiles.length}`)
  // Surface the submodule SHA — the version pointer post-migration.
  // Best-effort; if `git -C` fails we just skip the line.
  try {
    const shaResult = await spawn(
      'git',
      ['-C', WPT_SUBMODULE_DIR, 'rev-parse', 'HEAD'],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    )
    const sha = (shaResult.stdout ?? '').trim()
    if (sha) {
      logger.info(`WPT ref: ${sha.slice(0, 8)}`)
    }
  } catch {
    // Silent — informational only.
  }
  if (opts.filter) {
    logger.info(`Filter: ${opts.filter}`)
  }
  logger.log('')

  // Run tests
  let totalPassed = 0
  let totalFailed = 0
  let totalTests = 0
  let filesWithFailures = 0

  // Track failures against expected list. `matchedExpected` accumulates
  // across files; `unexpectedFailures` collects regressions.
  const matchedExpected = new Set<string>()
  const unexpectedFailures: UnexpectedFailure[] = []

  // Iterable is not a bare identifier.
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- see above
  for (const testFile of testFiles) {
    let result: TestResult
    try {
      result = await runTestFile(opts.binary, testFile)
    } catch (e) {
      const rel = path.relative(WPT_DIR, testFile)
      result = {
        file: rel,
        passed: 0,
        failed: 1,
        total: 1,
        errors: [`Runner error: ${errorMessage(e)}`],
      }
    }

    totalPassed += result.passed
    totalFailed += result.failed
    totalTests += result.total

    // Classify this file's failures against the allowlist. The
    // classifier is pure + unit-tested at
    // test/unit/wpt-streams-classifier.test.mts.
    const classification = classifyResult(result, EXPECTED_FAILURES)
    if (result.failed > 0) {
      filesWithFailures++
    }
    for (const key of classification.matchedExpected) {
      matchedExpected.add(key)
    }
    for (const u of classification.unexpected) {
      unexpectedFailures.push(u)
    }

    reportWptResult({ result, classification, verbose: opts.verbose })
  }

  const status = reportWptSummary({
    expectedFailures: EXPECTED_FAILURES,
    filesWithFailures,
    matchedExpected,
    testFileCount: testFiles.length,
    totalFailed,
    totalPassed,
    totalTests,
    unexpectedFailures,
  })
  if (status !== 0) {
    process.exitCode = status
  }
}

main().catch(err => {
  logger.fail(`WPT runner failed: ${errorMessage(err)}`)
  process.exitCode = 1
})
