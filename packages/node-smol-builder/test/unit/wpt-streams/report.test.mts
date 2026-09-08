import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  reportWptResult,
  reportWptSummary,
} from '../../scripts/wpt-streams/report.mts'

const logger = getDefaultLogger()
beforeEach(() => {
  vi.spyOn(logger, 'log').mockImplementation(() => undefined)
  vi.spyOn(logger, 'substep').mockImplementation(() => undefined)
  vi.spyOn(logger, 'error').mockImplementation(() => undefined)
  vi.spyOn(logger, 'fail').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

test('reports passing files without error details', () => {
  reportWptResult({
    result: { file: 'example.js', passed: 2, failed: 0, total: 2, errors: [] },
    classification: {
      allExpected: true,
      matchedExpected: new Set(),
      unexpected: [],
    },
    verbose: false,
  })
  expect(logger.log).toHaveBeenCalledTimes(1)
  expect(logger.substep).not.toHaveBeenCalled()
})

test.each([
  { verbose: false, count: 3 },
  { verbose: true, count: 4 },
])('bounds error details for verbose=$verbose', ({ verbose, count }) => {
  reportWptResult({
    result: {
      file: 'example.js',
      passed: 0,
      failed: 4,
      total: 4,
      errors: ['first', 'second', 'third', 'fourth'],
    },
    classification: {
      allExpected: false,
      matchedExpected: new Set(),
      unexpected: [],
    },
    verbose,
  })
  expect(logger.substep).toHaveBeenCalledTimes(count)
})

function summaryConfig() {
  return {
    __proto__: null,
    expectedFailures: new Set<string>(),
    filesWithFailures: 0,
    matchedExpected: new Set<string>(),
    testFileCount: 1,
    totalFailed: 0,
    totalPassed: 0,
    totalTests: 0,
    unexpectedFailures: [],
  }
}

test('returns success for an empty run without a nonfinite pass rate', () => {
  expect(reportWptSummary(summaryConfig())).toBe(0)
  expect(logger.substep).toHaveBeenCalledWith('Pass rate: 0%')
})

test('retains success when every observed failure is expected', () => {
  expect(
    reportWptSummary({
      ...summaryConfig(),
      expectedFailures: new Set(['example.js']),
      matchedExpected: new Set(['example.js']),
      totalFailed: 1,
      totalTests: 1,
      filesWithFailures: 1,
    }),
  ).toBe(0)
  expect(logger.fail).not.toHaveBeenCalled()
})

test('returns failure and bounds the displayed unexpected failures', () => {
  const unexpectedFailures = Array.from({ length: 11 }, (entry, index) => ({
    file: `example-${index}.js`,
    test: 'example case',
    error: 'example failure',
  }))
  expect(
    reportWptSummary({
      ...summaryConfig(),
      unexpectedFailures,
      totalFailed: 11,
      totalTests: 11,
    }),
  ).toBe(1)
  expect(logger.fail).toHaveBeenCalledTimes(1)
  expect(logger.substep).toHaveBeenLastCalledWith('... and 1 more')
})
