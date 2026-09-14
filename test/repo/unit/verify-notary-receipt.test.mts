import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { releaseNotaryEvidencePaths } from '../../../scripts/repo/paths.mts'
import {
  releaseEvidenceField,
  type ReleaseBundleIdentity,
} from '../../../scripts/repo/release/notary-receipt.mts'
import { verifyNotaryReceiptEvidence } from '../../../scripts/repo/release/verify-notary-receipt.mts'
import type { NotaryReceiptEvidence } from '../../../scripts/repo/release/verify-notary-receipt.mts'

const mocks = vi.hoisted(() => ({
  readReleaseArchiveIdentity: vi.fn(),
}))

vi.mock(
  '../../../scripts/repo/release/notary-receipt.mts',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('../../../scripts/repo/release/notary-receipt.mts')
    >()),
    readReleaseArchiveIdentity: mocks.readReleaseArchiveIdentity,
  }),
)

const submissionId = '12345678-1234-1234-1234-123456789abc'
const profileUuid = '87654321-4321-4321-4321-cba987654321'
const identity: ReleaseBundleIdentity = {
  binarySha256: 'a'.repeat(64),
  certificateSha256: 'B'.repeat(64),
  profileSha256: 'c'.repeat(64),
  profileUuid,
}
const expected = {
  architecture: 'arm64',
  repository: 'example/repository',
  runAttempt: '2',
  runId: '12345',
  source: 'd'.repeat(40),
  workflowRef:
    'example/repository/.github/workflows/repo-sign-macos.yml@refs/tags/v0.2.0',
}

let scratch = ''

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'notary-receipt-test-'))
  mocks.readReleaseArchiveIdentity.mockReset()
  mocks.readReleaseArchiveIdentity.mockResolvedValue(identity)
})

afterEach(async () => {
  await fs.rm(scratch, { force: true, recursive: true })
})

function measured(value: string) {
  return releaseEvidenceField(value, 'measured')
}

function imported(value: string) {
  return releaseEvidenceField(value, 'imported')
}

async function writeEvidence() {
  const archive = path.join(scratch, 'sockeye-darwin-arm64.zip')
  const paths = releaseNotaryEvidencePaths(archive)
  await fs.writeFile(archive, 'final archive')
  await fs.writeFile(paths.submission, 'submission archive')
  const archiveSha256 = crypto.hash('sha256', await fs.readFile(archive))
  const submissionSha256 = crypto.hash(
    'sha256',
    await fs.readFile(paths.submission),
  )
  const log = JSON.stringify({
    issues: [],
    jobId: submissionId,
    sha256: submissionSha256,
    status: 'Accepted',
  })
  await fs.writeFile(paths.log, log)
  const receipt: Record<string, unknown> = {
    architecture: imported(expected.architecture),
    archiveSha256: measured(archiveSha256),
    assessmentResult: measured('accepted'),
    binarySha256: measured(identity.binarySha256),
    certificateSha256: measured(identity.certificateSha256),
    codesignResult: measured('passed'),
    completedAt: measured('2026-09-14T00:00:00.000Z'),
    githubRepository: imported(expected.repository),
    githubRunAttempt: imported(expected.runAttempt),
    githubRunId: imported(expected.runId),
    githubWorkflowRef: imported(expected.workflowRef),
    logSha256: measured(crypto.hash('sha256', log)),
    macosVersion: measured('15.6'),
    profileSha256: measured(identity.profileSha256),
    profileUuid: measured(identity.profileUuid),
    sourceSha: imported(expected.source),
    stapleResult: measured('validated'),
    status: 'complete',
    submissionId: measured(submissionId),
    submissionSha256: measured(submissionSha256),
  }
  await fs.writeFile(paths.receipt, JSON.stringify(receipt))
  return { archive, paths, receipt }
}

function verificationEvidence(
  paths: ReturnType<typeof releaseNotaryEvidencePaths>,
) {
  return {
    expectedArchitecture: expected.architecture,
    expectedRepository: expected.repository,
    expectedRunAttempt: expected.runAttempt,
    expectedRunId: expected.runId,
    expectedSource: expected.source,
    expectedWorkflowRef: expected.workflowRef,
    log: paths.log,
    receipt: paths.receipt,
    submission: paths.submission,
  }
}

test('accepts bound final, submission, log, and workflow evidence', async () => {
  const { archive, paths } = await writeEvidence()
  await expect(
    verifyNotaryReceiptEvidence(verificationEvidence(paths), archive),
  ).resolves.toBe(true)
})

test('rejects changed submission bytes', async () => {
  const { archive, paths } = await writeEvidence()
  await fs.writeFile(paths.submission, 'changed submission archive')
  await expect(
    verifyNotaryReceiptEvidence(verificationEvidence(paths), archive),
  ).resolves.toBe(false)
})

test.each([
  ['jobId', '87654321-1234-1234-1234-123456789abc'],
  ['sha256', 'f'.repeat(64)],
  ['status', 'Rejected'],
  ['issues', [{ severity: 'error' }]],
] as const)('rejects changed notary log field %s', async (key, value) => {
  const { archive, paths, receipt } = await writeEvidence()
  const log = JSON.parse(await fs.readFile(paths.log, 'utf8')) as Record<
    string,
    unknown
  >
  log[key] = value
  const logText = JSON.stringify(log)
  await fs.writeFile(paths.log, logText)
  receipt['logSha256'] = measured(crypto.hash('sha256', logText))
  await fs.writeFile(paths.receipt, JSON.stringify(receipt))
  await expect(
    verifyNotaryReceiptEvidence(verificationEvidence(paths), archive),
  ).resolves.toBe(false)
})

test('rejects an identity change between submission and final archive', async () => {
  const { archive, paths } = await writeEvidence()
  mocks.readReleaseArchiveIdentity
    .mockResolvedValueOnce(identity)
    .mockResolvedValueOnce({ ...identity, binarySha256: 'e'.repeat(64) })
  await expect(
    verifyNotaryReceiptEvidence(verificationEvidence(paths), archive),
  ).resolves.toBe(false)
})

test('rejects receipt metadata from another run', async () => {
  const { archive, paths } = await writeEvidence()
  await expect(
    verifyNotaryReceiptEvidence(
      { ...verificationEvidence(paths), expectedRunId: '67890' },
      archive,
    ),
  ).resolves.toBe(false)
})

test('requires every receipt evidence file and binding', async () => {
  const { archive, paths } = await writeEvidence()
  const evidence: NotaryReceiptEvidence = verificationEvidence(paths)
  delete evidence.submission
  await expect(verifyNotaryReceiptEvidence(evidence, archive)).rejects.toThrow(
    'requires one archive',
  )
})

test('accepts verification without receipt evidence', async () => {
  await expect(verifyNotaryReceiptEvidence({}, undefined)).resolves.toBe(true)
})

test('rejects partial evidence without a receipt', async () => {
  await expect(
    verifyNotaryReceiptEvidence({ expectedSource: expected.source }, undefined),
  ).rejects.toThrow('requires one archive')
})
