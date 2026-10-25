import { expect, test } from 'vitest'
import { KEYCHAIN_CASES } from '../../../scripts/repo/keychain-evidence.mts'
import {
  keychainAttendanceAllowed,
  keychainCollectionPassed,
  keychainSuiteAllowed,
} from '../../../scripts/repo/test-keychain-interactive.mts'

test('requires foreground macOS attendance and rejects every CI value', () => {
  expect(keychainAttendanceAllowed({}, 'darwin', { foreground: true })).toBe(
    true,
  )
  expect(keychainAttendanceAllowed({}, 'linux', { foreground: true })).toBe(
    false,
  )
  expect(keychainAttendanceAllowed({}, 'darwin', { foreground: false })).toBe(
    false,
  )
  for (const CI of ['', 'false', 'true', '0', '1'])
    expect(
      keychainAttendanceAllowed({ CI }, 'darwin', { foreground: true }),
    ).toBe(false)
})

test('default, direct-file, and coverage discovery cannot select attended cases', () => {
  for (const environment of [
    {},
    { VITEST: 'true' },
    { COVERAGE: 'true' },
    { SOCKEYE_INTERACTIVE_TESTS: '0' },
    { SOCKEYE_INTERACTIVE_TESTS: '1', CI: '' },
  ])
    expect(
      keychainSuiteAllowed(environment, 'darwin', { foreground: true }),
    ).toBe(false)
  expect(
    keychainSuiteAllowed({ SOCKEYE_INTERACTIVE_TESTS: '1' }, 'darwin', {
      foreground: false,
    }),
  ).toBe(false)
  expect(
    keychainSuiteAllowed({ SOCKEYE_INTERACTIVE_TESTS: '1' }, 'darwin', {
      foreground: true,
    }),
  ).toBe(true)
})

test('all-skipped, malformed, incomplete, and unverified collections fail', () => {
  const records = KEYCHAIN_CASES.map(testCase => ({
    schemaVersion: 1,
    source: 'a'.repeat(40),
    binaryHash: 'b'.repeat(64),
    os: 'darwin-25.0.0',
    architecture: 'arm64',
    signingClass: 'ad-hoc',
    testCase,
    outcome: 'expected',
    promptCount: 1,
    status: 'passed',
  }))
  expect(keychainCollectionPassed(records)).toBe(true)
  for (const value of [
    null,
    [],
    records.slice(1),
    [...records, records[0]],
    records.map(record => ({
      ...record,
      status: 'unverified',
      outcome: 'not-observed',
      promptCount: null,
    })),
  ])
    expect(keychainCollectionPassed(value)).toBe(false)
})
