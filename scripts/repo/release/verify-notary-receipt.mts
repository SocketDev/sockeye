import crypto from 'node:crypto'
import fs from 'node:fs/promises'

import {
  completedNotaryReceiptIsValid,
  parseNotaryReceipt,
  readReleaseArchiveIdentity,
  releaseBundleIdentitiesMatch,
  releaseFileSha256,
} from './notary-receipt.mts'
import { notaryLogIsValid } from './notary-service.mts'

export interface NotaryReceiptEvidence {
  expectedArchitecture?: string | undefined
  expectedRepository?: string | undefined
  expectedRunAttempt?: string | undefined
  expectedRunId?: string | undefined
  expectedSource?: string | undefined
  expectedWorkflowRef?: string | undefined
  log?: string | undefined
  receipt?: string | undefined
  submission?: string | undefined
}

export async function verifyNotaryReceiptEvidence(
  evidence: NotaryReceiptEvidence,
  target: string | undefined,
): Promise<boolean> {
  if (Object.values(evidence).every(value => value === undefined)) {
    return true
  }
  if (
    target === undefined ||
    evidence.receipt === undefined ||
    evidence.expectedArchitecture === undefined ||
    evidence.expectedRepository === undefined ||
    evidence.expectedRunAttempt === undefined ||
    evidence.expectedRunId === undefined ||
    evidence.expectedSource === undefined ||
    evidence.expectedWorkflowRef === undefined ||
    evidence.log === undefined ||
    evidence.submission === undefined
  ) {
    throw new Error(
      'Receipt verification requires one archive and its source, architecture, run, submission, and notary log evidence.',
    )
  }
  const receiptValue: unknown = JSON.parse(
    await fs.readFile(evidence.receipt, 'utf8'),
  )
  const receipt = parseNotaryReceipt(receiptValue)
  const submissionSha256 = await releaseFileSha256(evidence.submission)
  const logText = await fs.readFile(evidence.log, 'utf8')
  const archiveIdentity = await readReleaseArchiveIdentity(target)
  const submissionIdentity = await readReleaseArchiveIdentity(
    evidence.submission,
    { stapled: false },
  )
  return (
    releaseBundleIdentitiesMatch(archiveIdentity, submissionIdentity) &&
    notaryLogIsValid(
      JSON.parse(logText),
      receipt.submissionId,
      submissionSha256,
    ) &&
    completedNotaryReceiptIsValid(receiptValue, {
      architecture: evidence.expectedArchitecture,
      archiveSha256: await releaseFileSha256(target),
      bundleIdentity: archiveIdentity,
      githubRepository: evidence.expectedRepository,
      githubRunAttempt: evidence.expectedRunAttempt,
      githubRunId: evidence.expectedRunId,
      githubWorkflowRef: evidence.expectedWorkflowRef,
      logSha256: crypto.hash('sha256', logText),
      sourceSha: evidence.expectedSource,
      submissionSha256,
    })
  )
}
