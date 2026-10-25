import crypto from 'node:crypto'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../../fleet/paths.mts'

export const NOTARY_SUBMIT_TIMEOUT_MS = 120_000
export const NOTARY_WAIT_TIMEOUT_MS = 900_000

export interface NotarySubmission {
  archive: string
  keychain?: string | undefined
  profile: string
}

export interface NotaryLogEvidence {
  json: string
  sha256: string
}

export function notarySubmissionIdIsValid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
}

export function notaryLogIsValid(
  response: unknown,
  submissionId: string,
  submissionSha256: string,
): boolean {
  if (!isPlainObject(response)) {
    return false
  }
  const issues = response['issues']
  return (
    response['jobId'] === submissionId &&
    response['status'] === 'Accepted' &&
    typeof response['sha256'] === 'string' &&
    response['sha256'].toLowerCase() === submissionSha256 &&
    (issues === null ||
      (Array.isArray(issues) &&
        issues.every(
          issue =>
            isPlainObject(issue) &&
            typeof issue['severity'] === 'string' &&
            issue['severity'].toLowerCase() === 'warning',
        )))
  )
}

export class NotarySubmissionError extends Error {
  submissionId: string | undefined

  constructor(message: string, submissionId?: string | undefined) {
    super(message)
    this.name = 'NotarySubmissionError'
    this.submissionId = submissionId
  }
}

export function keychainArgs(
  config: Pick<NotarySubmission, 'keychain' | 'profile'>,
) {
  return [
    '--keychain-profile',
    config.profile,
    ...(config.keychain === undefined ? [] : ['--keychain', config.keychain]),
  ]
}

export function notarySubmissionArgs(config: NotarySubmission): string[] {
  return [
    'notarytool',
    'submit',
    config.archive,
    ...keychainArgs(config),
    '--output-format',
    'json',
  ]
}

export function parseNotaryJson(
  stdout: string,
  action: string,
): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    throw new Error(
      `Apple ${action} response was unreadable; no release output was written. Inspect the notary service before retrying.`,
    )
  }
  if (!isPlainObject(value)) {
    throw new Error(
      `Apple ${action} response was invalid; expected a JSON object. Inspect the notary service before retrying.`,
    )
  }
  return value
}

export async function submitNotaryArchive(
  config: NotarySubmission,
): Promise<string> {
  const result = await spawn('/usr/bin/xcrun', notarySubmissionArgs(config), {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    throws: false,
    timeout: NOTARY_SUBMIT_TIMEOUT_MS,
  })
  let response: Record<string, unknown>
  try {
    response = parseNotaryJson(result.stdout ?? '', 'submission')
  } catch (error) {
    throw new NotarySubmissionError(errorMessage(error))
  }
  const id = response['id']
  const validId = notarySubmissionIdIsValid(id)
  const status = response['status']
  const validStatus =
    status === undefined ||
    status === 'Accepted' ||
    status === 'In Progress' ||
    status === 'Uploaded'
  if (result.code !== 0 || !validId || !validStatus) {
    throw new NotarySubmissionError(
      `Apple did not confirm the notarization upload for ${config.archive}; expected a submission ID. Inspect submission ${validId ? id : 'without an ID'} before retrying.`,
      validId ? (id as string) : undefined,
    )
  }
  return id as string
}

export async function waitForNotarySubmission(
  submissionId: string,
  config: Pick<NotarySubmission, 'keychain' | 'profile'>,
): Promise<void> {
  const result = await spawn(
    '/usr/bin/xcrun',
    [
      'notarytool',
      'wait',
      submissionId,
      ...keychainArgs(config),
      '--output-format',
      'json',
    ],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      throws: false,
      timeout: NOTARY_WAIT_TIMEOUT_MS,
    },
  )
  const response = parseNotaryJson(result.stdout ?? '', 'wait')
  if (result.code !== 0 || response['status'] !== 'Accepted') {
    throw new Error(
      `Apple did not accept resumed submission ${submissionId}; expected terminal Accepted status. Inspect its notarization history before publication.`,
    )
  }
}

export async function inspectNotaryLog(
  submissionId: string,
  submissionSha256: string,
  config: Pick<NotarySubmission, 'keychain' | 'profile'>,
): Promise<NotaryLogEvidence> {
  const result = await spawn(
    '/usr/bin/xcrun',
    [
      'notarytool',
      'log',
      submissionId,
      ...keychainArgs(config),
      '--output-format',
      'json',
    ],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  )
  if (result.code !== 0) {
    throw new Error(
      `Apple notarization log retrieval failed for ${submissionId}; no release output was written. Retry log retrieval before publication.`,
    )
  }
  const stdout = result.stdout ?? ''
  const response = parseNotaryJson(stdout, 'notarization log')
  if (!notaryLogIsValid(response, submissionId, submissionSha256)) {
    throw new Error(
      `Apple notarization log rejected for ${submissionId}; expected Accepted status, matching identity and digest, and no errors. Resolve the log before publication.`,
    )
  }
  return { json: stdout, sha256: crypto.hash('sha256', stdout) }
}
