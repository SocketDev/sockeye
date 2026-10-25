import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { findStaleAllowlistEntries } from './classifier.mts'
import type { Classification, TestResult, UnexpectedFailure } from './types.mts'

const logger = getDefaultLogger()

export function reportWptResult(config: {
  result: TestResult
  classification: Classification
  verbose: boolean
}): void {
  const { result, classification, verbose } = {
    __proto__: null,
    ...config,
  } as typeof config
  // Status: green checkmark, yellow tilde (expected fail), red X (unexpected fail)
  let status
  if (result.failed === 0) {
    // WPT validator emits ANSI-colored status markers ("\x1b[32mOK\x1b[0m"
    // etc.) in column-aligned table rows; logger.success() would lose the
    // colorization required by the WPT result format.
    // oxlint-disable-next-line socket/no-status-emoji -- see above
    status = '\x1b[32m✓\x1b[0m'
  } else {
    // WPT validator emits ANSI-colored status markers ("\x1b[32mOK\x1b[0m"
    // etc.) in column-aligned table rows; logger.success() would lose the
    // colorization required by the WPT result format.
    // oxlint-disable-next-line socket/no-status-emoji -- see above
    status = classification.allExpected
      ? '\x1b[33m~\x1b[0m'
      : '\x1b[31m✗\x1b[0m'
  }

  logger.log(`${status} ${result.file} (${result.passed}/${result.total})`)

  if (result.failed > 0) {
    if (verbose) {
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const err of result.errors) {
        logger.substep(err)
      }
    } else if (result.errors.length > 0) {
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const err of result.errors.slice(0, 2)) {
        logger.substep(err)
      }
      if (result.errors.length > 2) {
        logger.substep(`... and ${result.errors.length - 2} more`)
      }
    }
  }
}

export function reportWptSummary(config: {
  expectedFailures: Set<string>
  filesWithFailures: number
  matchedExpected: Set<string>
  testFileCount: number
  totalFailed: number
  totalPassed: number
  totalTests: number
  unexpectedFailures: UnexpectedFailure[]
}): number {
  const {
    expectedFailures,
    filesWithFailures,
    matchedExpected,
    testFileCount,
    totalFailed,
    totalPassed,
    totalTests,
    unexpectedFailures,
  } = { __proto__: null, ...config } as typeof config
  // Find expected failures that now pass (improvements) — stale
  // allowlist entries. Surfaced to the user so they can prune.
  const nowPassing = findStaleAllowlistEntries(
    expectedFailures,
    matchedExpected,
  )

  // Summary
  logger.log('')
  logger.log('='.repeat(60))
  logger.log('Results:')
  logger.substep(`Total tests: ${totalTests}`)
  logger.substep(`Passed: \x1b[32m${totalPassed}\x1b[0m`)
  logger.substep(`Failed: \x1b[31m${totalFailed}\x1b[0m`)
  logger.substep(
    `Pass rate: ${totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0}%`,
  )
  logger.substep(`Files with failures: ${filesWithFailures}/${testFileCount}`)

  // Expected vs unexpected
  logger.log('')
  logger.substep(
    `Expected failures: ${matchedExpected.size}/${expectedFailures.size}`,
  )
  logger.substep(`Unexpected failures: ${unexpectedFailures.length}`)

  if (nowPassing.length > 0) {
    logger.log('')
    logger.log('[32m✨ Tests that now PASS (update expected failures list):[0m')
    for (let i = 0, { length } = nowPassing; i < length; i += 1) {
      const key = nowPassing[i]
      logger.substep(`- ${key}`)
    }
  }

  if (unexpectedFailures.length > 0) {
    logger.error('')
    // WPT validator emits ANSI-colored status markers ("\x1b[32mOK\x1b[0m"
    // etc.) in column-aligned table rows; logger.success() would lose the
    // colorization required by the WPT result format.
    // oxlint-disable-next-line socket/no-status-emoji -- emoji is payload data
    logger.fail('[31m❌ UNEXPECTED failures (regressions):[0m')
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
    for (const { file, test } of unexpectedFailures.slice(0, 10)) {
      logger.substep(`- ${file}: ${test}`)
    }
    if (unexpectedFailures.length > 10) {
      logger.substep(`... and ${unexpectedFailures.length - 10} more`)
    }
  }

  // Exit with failure only if there are unexpected failures
  if (unexpectedFailures.length > 0) {
    logger.log('')
    logger.log('[31mFAILED: Unexpected test failures detected[0m')
    return 1
  } else if (totalFailed > 0) {
    logger.log('')
    logger.log(
      '[32mPASSED: All failures are expected (matches native Node 25)[0m',
    )
  }
  return 0
}
