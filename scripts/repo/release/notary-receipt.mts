import crypto from 'node:crypto'
import fs from 'node:fs/promises'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../../fleet/paths.mts'
import {
  releaseBundleDirectoryPath,
  releaseBundlePaths,
  releaseNotaryReceiptScratchPrefix,
} from '../paths.mts'
import {
  readReleaseCertificateSha256,
  readReleaseProfile,
  releaseArchiveEntriesAreValid,
  releaseArchiveMemberTypesAreValid,
} from './bundle.mts'
import { notarySubmissionIdIsValid } from './notary-service.mts'

export interface ReleaseBundleIdentity {
  binarySha256: string
  certificateSha256: string
  profileSha256: string
  profileUuid: string
}

export type EvidenceSource = 'imported' | 'measured' | 'unavailable'

export interface EvidenceField {
  source: EvidenceSource
  value: string | undefined
}

export function releaseEvidenceField(
  value: string | undefined,
  source: Exclude<EvidenceSource, 'unavailable'>,
): EvidenceField {
  return value === undefined
    ? { source: 'unavailable', value: undefined }
    : { source, value }
}

export function releaseEvidenceValue(
  receipt: Record<string, unknown>,
  key: string,
  source: EvidenceSource,
): string | undefined {
  const field = receipt[key]
  return isPlainObject(field) &&
    field['source'] === source &&
    typeof field['value'] === 'string'
    ? field['value']
    : undefined
}

export interface NotaryReceipt extends ReleaseBundleIdentity {
  submissionId: string
  submissionSha256: string
}

export function notaryReceiptString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key]
  return typeof field === 'string'
    ? field
    : releaseEvidenceValue(value, key, 'measured')
}

export function parseNotaryReceipt(value: unknown): NotaryReceipt {
  if (!isPlainObject(value)) {
    throw new Error(
      'Notary receipt is invalid; expected a submission ID and SHA-256 digest. Use the receipt written by this script.',
    )
  }
  const submissionId = notaryReceiptString(value, 'submissionId')
  const submissionSha256 = notaryReceiptString(value, 'submissionSha256')
  const binarySha256 = notaryReceiptString(value, 'binarySha256')
  const certificateSha256 = notaryReceiptString(value, 'certificateSha256')
  const profileSha256 = notaryReceiptString(value, 'profileSha256')
  const profileUuid = notaryReceiptString(value, 'profileUuid')
  if (
    !notarySubmissionIdIsValid(submissionId) ||
    submissionSha256 === undefined ||
    !/^[a-f0-9]{64}$/u.test(submissionSha256) ||
    binarySha256 === undefined ||
    !/^[a-f0-9]{64}$/u.test(binarySha256) ||
    certificateSha256 === undefined ||
    !/^[A-F0-9]{64}$/u.test(certificateSha256) ||
    profileSha256 === undefined ||
    !/^[a-f0-9]{64}$/u.test(profileSha256) ||
    !notarySubmissionIdIsValid(profileUuid)
  ) {
    throw new Error(
      'Notary receipt is invalid; expected a submission ID and SHA-256 digest. Use the receipt written by this script.',
    )
  }
  return {
    binarySha256,
    certificateSha256,
    profileSha256,
    profileUuid,
    submissionId,
    submissionSha256,
  }
}

export function completedNotaryReceiptIsValid(
  value: unknown,
  expected: {
    architecture: string
    archiveSha256: string
    bundleIdentity: ReleaseBundleIdentity
    githubRunAttempt: string
    githubRunId: string
    githubRepository: string
    githubWorkflowRef: string
    logSha256: string
    sourceSha: string
    submissionSha256: string
  },
): boolean {
  if (!isPlainObject(value)) {
    return false
  }
  return [
    value['status'] === 'complete',
    releaseEvidenceValue(value, 'architecture', 'imported') ===
      expected.architecture,
    releaseEvidenceValue(value, 'archiveSha256', 'measured') ===
      expected.archiveSha256,
    releaseEvidenceValue(value, 'binarySha256', 'measured') ===
      expected.bundleIdentity.binarySha256,
    releaseEvidenceValue(value, 'certificateSha256', 'measured') ===
      expected.bundleIdentity.certificateSha256,
    releaseEvidenceValue(value, 'profileSha256', 'measured') ===
      expected.bundleIdentity.profileSha256,
    releaseEvidenceValue(value, 'profileUuid', 'measured') ===
      expected.bundleIdentity.profileUuid,
    releaseEvidenceValue(value, 'logSha256', 'measured') === expected.logSha256,
    releaseEvidenceValue(value, 'submissionSha256', 'measured') ===
      expected.submissionSha256,
    releaseEvidenceValue(value, 'sourceSha', 'imported') === expected.sourceSha,
    releaseEvidenceValue(value, 'githubRunId', 'imported') ===
      expected.githubRunId,
    releaseEvidenceValue(value, 'githubRunAttempt', 'imported') ===
      expected.githubRunAttempt,
    releaseEvidenceValue(value, 'githubRepository', 'imported') ===
      expected.githubRepository,
    releaseEvidenceValue(value, 'githubWorkflowRef', 'imported') ===
      expected.githubWorkflowRef,
    notarySubmissionIdIsValid(
      releaseEvidenceValue(value, 'submissionId', 'measured'),
    ),
    releaseEvidenceValue(value, 'codesignResult', 'measured') === 'passed',
    releaseEvidenceValue(value, 'stapleResult', 'measured') === 'validated',
    releaseEvidenceValue(value, 'assessmentResult', 'measured') === 'accepted',
    !Number.isNaN(
      Date.parse(releaseEvidenceValue(value, 'completedAt', 'measured') ?? ''),
    ),
    (releaseEvidenceValue(value, 'macosVersion', 'measured')?.length ?? 0) > 0,
  ].every(Boolean)
}

export async function releaseFileSha256(filename: string): Promise<string> {
  return crypto.hash('sha256', await fs.readFile(filename))
}

export async function readReleaseBundleIdentity(
  bundle: string,
): Promise<ReleaseBundleIdentity> {
  const files = releaseBundlePaths(bundle)
  const profile = await readReleaseProfile(files.profile)
  const profileUuid = isPlainObject(profile) ? profile['UUID'] : undefined
  if (!notarySubmissionIdIsValid(profileUuid)) {
    throw new Error(
      `Provisioning profile UUID is invalid in ${bundle}; expected an Apple UUID. Regenerate the release profile.`,
    )
  }
  return {
    binarySha256: await releaseFileSha256(files.binary),
    certificateSha256: await readReleaseCertificateSha256(bundle),
    profileSha256: await releaseFileSha256(files.profile),
    profileUuid,
  }
}

export function releaseBundleIdentitiesMatch(
  left: ReleaseBundleIdentity,
  right: ReleaseBundleIdentity,
): boolean {
  return (
    left.binarySha256 === right.binarySha256 &&
    left.certificateSha256 === right.certificateSha256 &&
    left.profileSha256 === right.profileSha256 &&
    left.profileUuid === right.profileUuid
  )
}

export async function readReleaseArchiveIdentity(
  archive: string,
  options: { stapled?: boolean | undefined } = {},
): Promise<ReleaseBundleIdentity> {
  const listing = await spawn('/usr/bin/unzip', ['-Z1', archive], {
    cwd: REPO_ROOT,
  })
  const entries = listing.stdout
    ? listing.stdout.split(/\r?\n/u).filter(Boolean)
    : []
  const metadata = await spawn('/usr/bin/zipinfo', ['-l', archive], {
    cwd: REPO_ROOT,
  })
  if (
    listing.code !== 0 ||
    metadata.code !== 0 ||
    !releaseArchiveEntriesAreValid(entries, options) ||
    !releaseArchiveMemberTypesAreValid(entries, metadata.stdout ?? '')
  ) {
    throw new Error(
      `Receipt archive rejected at ${archive}; expected the exact safe Sockeye bundle layout. Rebuild the release archive.`,
    )
  }
  const scratch = await fs.mkdtemp(releaseNotaryReceiptScratchPrefix())
  try {
    const result = await spawn(
      '/usr/bin/unzip',
      ['-q', archive, '-d', scratch],
      { cwd: REPO_ROOT },
    )
    if (result.code !== 0) {
      throw new Error(
        `Receipt archive extraction failed at ${archive}; expected the verified release ZIP. Re-run release verification.`,
      )
    }
    return readReleaseBundleIdentity(releaseBundleDirectoryPath(scratch))
  } finally {
    await safeDelete(scratch)
  }
}

export async function writeNotaryReceipt(
  filename: string,
  value: Record<string, string>,
): Promise<void> {
  await fs.writeFile(filename, `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

export async function writeCompletedNotaryReceipt(
  filename: string,
  evidence: {
    archiveSha256: string
    assessmentResult: string
    bundleIdentity: ReleaseBundleIdentity
    codesignResult: string
    logSha256: string
    stapleResult: string
    submissionId: string
    submissionSha256: string
  },
): Promise<void> {
  const macos = await spawn('/usr/bin/sw_vers', ['-productVersion'])
  const imported = (name: string) =>
    releaseEvidenceField(getEnvValue(name), 'imported')
  const measured = (value: string) => releaseEvidenceField(value, 'measured')
  await fs.writeFile(
    filename,
    `${JSON.stringify({
      architecture: releaseEvidenceField(
        getEnvValue('SOCKEYE_TARGET_ARCH'),
        'imported',
      ),
      archiveSha256: measured(evidence.archiveSha256),
      assessmentResult: measured(evidence.assessmentResult),
      binarySha256: measured(evidence.bundleIdentity.binarySha256),
      certificateSha256: measured(evidence.bundleIdentity.certificateSha256),
      codesignResult: measured(evidence.codesignResult),
      completedAt: measured(new Date().toISOString()),
      githubRepository: imported('GITHUB_REPOSITORY'),
      githubRunAttempt: imported('GITHUB_RUN_ATTEMPT'),
      githubRunId: imported('GITHUB_RUN_ID'),
      githubWorkflowRef: imported('GITHUB_WORKFLOW_REF'),
      logSha256: measured(evidence.logSha256),
      macosVersion: measured(`${macos.stdout ?? ''}`.trim()),
      profileSha256: measured(evidence.bundleIdentity.profileSha256),
      profileUuid: measured(evidence.bundleIdentity.profileUuid),
      sourceSha: imported('GITHUB_SHA'),
      stapleResult: measured(evidence.stapleResult),
      status: 'complete',
      submissionId: measured(evidence.submissionId),
      submissionSha256: measured(evidence.submissionSha256),
    })}\n`,
    { mode: 0o600 },
  )
}
