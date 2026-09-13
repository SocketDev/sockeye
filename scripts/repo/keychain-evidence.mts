import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

export const KEYCHAIN_CASES = [
  'fresh-set',
  'replacement',
  'cancelled-replacement',
  'delete-repeat',
  'cancelled-delete',
  'missing-item',
  'policy-mismatch',
  'enrollment-change',
  'no-biometry',
  'lockout-cancellation-session-lock',
  'one-password-import',
  'repeat-run',
  'new-mac',
  'release-binary',
] as const

export const KEYCHAIN_ARCHITECTURES = ['arm64', 'x64'] as const
export type KeychainArchitecture = (typeof KEYCHAIN_ARCHITECTURES)[number]
export type KeychainCase = (typeof KEYCHAIN_CASES)[number]

export interface KeychainEvidence {
  schemaVersion: 1
  source: string
  binaryHash: string
  os: string
  architecture: KeychainArchitecture
  signingClass: 'unsigned' | 'ad-hoc' | 'developer-id'
  testCase: KeychainCase
  outcome: 'expected' | 'unexpected' | 'not-observed'
  promptCount: number | null
  status: 'passed' | 'failed' | 'unverified'
}

export interface KeychainArtifact {
  architecture: KeychainArchitecture
  binaryHash: string
}

export function readKeychainArtifact(filename: string): KeychainArtifact {
  const bytes = readFileSync(filename)
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfe_ed_fa_cf) {
    throw new Error(
      'Artifact rejected at binary header: expected thin 64-bit Mach-O. Supply each architecture binary separately.',
    )
  }
  const cpu = bytes.readUInt32LE(4)
  if (cpu !== 0x01_00_00_0c && cpu !== 0x01_00_00_07) {
    throw new Error(
      'Artifact rejected at CPU header: expected arm64 or x64. Supply release architecture binaries.',
    )
  }
  return {
    architecture: cpu === 0x01_00_00_0c ? 'arm64' : 'x64',
    binaryHash: crypto.createHash('sha256').update(bytes).digest('hex'),
  }
}

export function isKeychainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isKeychainEvidence(value: unknown): value is KeychainEvidence {
  if (!isKeychainRecord(value)) {
    return false
  }
  const item = value
  const keys = [
    'schemaVersion',
    'source',
    'binaryHash',
    'os',
    'architecture',
    'signingClass',
    'testCase',
    'outcome',
    'promptCount',
    'status',
  ]
  if (
    Object.keys(item).length !== keys.length ||
    keys.some(key => !Object.hasOwn(item, key))
  ) {
    return false
  }
  return keychainMetadataValid(item) && keychainObservationValid(item)
}

function keychainMetadataValid(item: Record<string, unknown>): boolean {
  if (
    item['schemaVersion'] !== 1 ||
    typeof item['source'] !== 'string' ||
    !/^[a-f0-9]{40}$/.test(item['source'])
  ) {
    return false
  }
  if (
    typeof item['binaryHash'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item['binaryHash'])
  ) {
    return false
  }
  if (
    typeof item['os'] !== 'string' ||
    !/^darwin-[0-9]+\.[0-9]+\.[0-9]+$/.test(item['os'])
  ) {
    return false
  }
  if (
    !KEYCHAIN_ARCHITECTURES.some(
      architecture => architecture === item['architecture'],
    )
  ) {
    return false
  }
  if (
    !['unsigned', 'ad-hoc', 'developer-id'].some(
      signingClass => signingClass === item['signingClass'],
    )
  ) {
    return false
  }
  if (!KEYCHAIN_CASES.some(testCase => testCase === item['testCase'])) {
    return false
  }
  return true
}

function keychainObservationValid(item: Record<string, unknown>): boolean {
  const count = item['promptCount']
  if (
    count !== null &&
    (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
  ) {
    return false
  }
  switch (item['status']) {
    case 'passed':
      return item['outcome'] === 'expected' && count !== null
    case 'failed':
      return item['outcome'] === 'unexpected' && count !== null
    case 'unverified':
      return item['outcome'] === 'not-observed' && count === null
    default:
      return false
  }
}

export function validateKeychainEvidence(
  values: unknown[],
  artifacts: KeychainArtifact[],
  sourceCommit: string,
): string[] {
  const issues: string[] = []
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    issues.push('invalid-source')
  }
  if (
    artifacts.length !== KEYCHAIN_ARCHITECTURES.length ||
    KEYCHAIN_ARCHITECTURES.some(
      architecture =>
        artifacts.filter(artifact => artifact.architecture === architecture)
          .length !== 1,
    )
  ) {
    issues.push('architecture-set')
  }
  const seen = new Set<string>()
  for (let i = 0, { length } = values; i < length; i += 1) {
    const value = values[i]!
    if (!isKeychainEvidence(value)) {
      issues.push('invalid-record')
      continue
    }
    const key = `${value.architecture}:${value.testCase}`
    if (seen.has(key)) {
      issues.push(`duplicate:${key}`)
    }
    seen.add(key)
    if (value.source !== sourceCommit) {
      issues.push(`stale-source:${key}`)
    }
    if (
      artifacts.find(artifact => artifact.architecture === value.architecture)
        ?.binaryHash !== value.binaryHash
    ) {
      issues.push(`stale-binary:${key}`)
    }
    if (value.status !== 'passed') {
      issues.push(`incomplete:${key}`)
    }
    if (value.signingClass !== 'developer-id') {
      issues.push(`release-signing:${key}`)
    }
  }
  for (const architecture of KEYCHAIN_ARCHITECTURES) {
    for (const testCase of KEYCHAIN_CASES) {
      if (!seen.has(`${architecture}:${testCase}`)) {
        issues.push(`missing:${architecture}:${testCase}`)
      }
    }
  }
  return issues
}
