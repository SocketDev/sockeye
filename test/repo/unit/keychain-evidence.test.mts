import { expect, test } from 'vitest'
import {
  KEYCHAIN_ARCHITECTURES,
  KEYCHAIN_CASES,
  isKeychainEvidence,
  validateKeychainEvidence,
} from '../../../scripts/repo/keychain-evidence.mts'
import type {
  KeychainArtifact,
  KeychainEvidence,
} from '../../../scripts/repo/keychain-evidence.mts'

const source = 'a'.repeat(40)
const artifacts: KeychainArtifact[] = KEYCHAIN_ARCHITECTURES.map(
  (architecture, index) => ({
    architecture,
    binaryHash: String(index + 1).repeat(64),
  }),
)
const records: KeychainEvidence[] = artifacts.flatMap(artifact =>
  KEYCHAIN_CASES.map(testCase => ({
    ...artifact,
    schemaVersion: 1,
    source,
    os: 'darwin-25.0.0',
    signingClass: 'developer-id',
    testCase,
    outcome: 'expected',
    promptCount: 2,
    status: 'passed',
  })),
)

test('requires every case for each supplied architecture', () => {
  expect(validateKeychainEvidence(records, artifacts, source)).toEqual([])
  expect(
    validateKeychainEvidence(records.slice(1), artifacts, source),
  ).not.toEqual([])
  expect(
    validateKeychainEvidence(records, artifacts.slice(1), source),
  ).not.toEqual([])
  expect(
    validateKeychainEvidence(records, [artifacts[0]!, artifacts[0]!], source),
  ).not.toEqual([])
})

test('rejects stale, duplicate, failed, and unverified observations', () => {
  expect(
    validateKeychainEvidence(records, artifacts, 'b'.repeat(40)),
  ).not.toEqual([])
  expect(
    validateKeychainEvidence(
      records,
      artifacts.map(artifact => ({ ...artifact, binaryHash: 'f'.repeat(64) })),
      source,
    ),
  ).not.toEqual([])
  expect(
    validateKeychainEvidence([...records, records[0]], artifacts, source),
  ).not.toEqual([])
  for (const change of [
    { status: 'failed', outcome: 'unexpected', promptCount: 1 },
    { status: 'unverified', outcome: 'not-observed', promptCount: null },
  ]) {
    expect(isKeychainEvidence({ ...records[0], ...change })).toBe(true)
    expect(
      validateKeychainEvidence(
        [{ ...records[0], ...change }, ...records.slice(1)],
        artifacts,
        source,
      ),
    ).not.toEqual([])
  }
})

test('rejects malformed records and secret-bearing extra fields', () => {
  for (const value of [
    null,
    [],
    {},
    { ...records[0], credential: 'fake' },
    { ...records[0], promptCount: -1 },
    { ...records[0], promptCount: 0.5 },
    { ...records[0], promptCount: null },
    { ...records[0], os: 'host-name' },
    { ...records[0], source: 'HEAD' },
    { ...records[0], architecture: 'arm' },
    { ...records[0], signingClass: 'unknown' },
    { ...records[0], testCase: 'skipped' },
    { ...records[0], binaryHash: 'bad' },
    { ...records[0], schemaVersion: 2 },
    { ...records[0], status: 'skipped' },
  ]) {
    expect(isKeychainEvidence(value)).toBe(false)
  }
  expect(validateKeychainEvidence([{}], artifacts, 'HEAD')).not.toEqual([])
})
