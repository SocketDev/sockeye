import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'

import {
  checkKeychainEvidenceArguments,
  checkKeychainTooling,
} from '../../../scripts/repo/check/keychain-evidence-is-complete.mts'
import {
  KEYCHAIN_CASES,
  readKeychainArtifact,
} from '../../../scripts/repo/keychain-evidence.mts'

const root = mkdtempSync(path.join(os.tmpdir(), 'sockeye-keychain-evidence-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const binaryFiles = ['arm64', 'x64'].map((architecture, index) => {
  const filename = path.join(root, architecture)
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(index ? 0x01000007 : 0x0100000c, 4)
  writeFileSync(filename, header)
  return filename
})
const source = 'a'.repeat(40)
const records = binaryFiles.flatMap(filename =>
  KEYCHAIN_CASES.map(testCase => ({
    ...readKeychainArtifact(filename),
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

function evidenceArguments(directory: string): string[] {
  return [
    directory,
    '--binary',
    binaryFiles[0]!,
    '--binary',
    binaryFiles[1]!,
    '--source',
    source,
  ]
}

test('strict filesystem check hashes artifacts and validates full observations', () => {
  const directory = path.join(root, 'valid')
  mkdirSync(directory)
  writeFileSync(
    path.join(directory, 'observations.json'),
    JSON.stringify(records),
  )
  expect(checkKeychainEvidenceArguments(evidenceArguments(directory))).toEqual(
    [],
  )
  expect(
    checkKeychainEvidenceArguments(['--', ...evidenceArguments(directory)]),
  ).toEqual([])
  writeFileSync(
    path.join(directory, 'observations.json'),
    JSON.stringify(
      records.map(record => ({ ...record, binaryHash: 'f'.repeat(64) })),
    ),
  )
  expect(
    checkKeychainEvidenceArguments(evidenceArguments(directory)),
  ).not.toEqual([])
  writeFileSync(path.join(directory, 'observations.json'), '{}')
  expect(
    checkKeychainEvidenceArguments(evidenceArguments(directory)),
  ).not.toEqual([])
  expect(checkKeychainEvidenceArguments([])).not.toEqual([])
})

test('artifact parsing rejects non-Mach-O and unsupported CPU headers', () => {
  const filename = path.join(root, 'invalid-binary')
  writeFileSync(filename, 'not executable')
  expect(() => readKeychainArtifact(filename)).toThrow()
  const bytes = Buffer.alloc(32)
  bytes.writeUInt32LE(0xfeedfacf, 0)
  writeFileSync(filename, bytes)
  expect(() => readKeychainArtifact(filename)).toThrow()
})

test('tooling-only mode requires documented matrix and explicit entry wiring', () => {
  const directory = path.join(root, 'tooling')
  mkdirSync(path.join(directory, 'docs'), { recursive: true })
  writeFileSync(
    path.join(directory, 'docs/keychain-validation.md'),
    KEYCHAIN_CASES.map(testCase => `\`${testCase}\``).join('\n'),
  )
  const scripts = {
    test: 'node scripts/repo/test.mts',
    'test:keychain:interactive':
      'node scripts/repo/test-keychain-interactive.mts',
    'check:keychain-evidence':
      'node scripts/repo/check/keychain-evidence-is-complete.mts',
  }
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ scripts }),
  )
  expect(checkKeychainTooling(directory)).toEqual([])
  writeFileSync(path.join(directory, 'package.json'), '{}')
  writeFileSync(path.join(directory, 'docs/keychain-validation.md'), '')
  expect(checkKeychainTooling(directory)).not.toEqual([])
})
