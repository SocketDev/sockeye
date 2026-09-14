#!/usr/bin/env node
import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import {
  getScriptArgs,
  getScriptLogger,
} from '../fleet/process/script-output.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import {
  releaseNotaryEvidencePaths,
  releaseNotaryWorkingPaths,
} from './paths.mts'
import {
  RELEASE_DESIGNATED_REQUIREMENT,
  validateReleaseBundleMetadata,
} from './release/bundle.mts'
import {
  parseNotaryReceipt,
  readReleaseBundleIdentity,
  releaseBundleIdentitiesMatch,
  releaseFileSha256,
  writeCompletedNotaryReceipt,
  writeNotaryReceipt,
} from './release/notary-receipt.mts'
import type { ReleaseBundleIdentity } from './release/notary-receipt.mts'
export { parseNotaryReceipt } from './release/notary-receipt.mts'
import {
  inspectNotaryLog,
  notarySubmissionArgs,
  NotarySubmissionError,
  submitNotaryArchive,
  waitForNotarySubmission,
} from './release/notary-service.mts'
export {
  inspectNotaryLog,
  keychainArgs,
  NOTARY_SUBMIT_TIMEOUT_MS,
  NOTARY_WAIT_TIMEOUT_MS,
  notarySubmissionArgs,
  parseNotaryJson,
  submitNotaryArchive,
  waitForNotarySubmission,
} from './release/notary-service.mts'
import { displayCommand } from './sign.mts'

const logger = getScriptLogger()

export const SCRIPT_META: ScriptMeta = {
  describe: 'Notarize, staple, validate, and package a signed Sockeye app.',
  help: 'Usage: pnpm run notarize [--run] --bundle <app> --output <zip> [--keychain-profile <name>] [--keychain <path>] [--resume <receipt>]',
  json: 'result',
}
export const NOTARY_PROFILE_ENV = 'SOCKEYE_NOTARY_PROFILE'
export async function runXcrun(args: string[]): Promise<void> {
  const result = await spawn('/usr/bin/xcrun', args, { cwd: REPO_ROOT })
  if (result.code !== 0) {
    throw new Error(
      `Apple ${args[0]} failed for ${args.at(-1) ?? 'the release bundle'}; no release output was written. Inspect the signed app and retry.`,
    )
  }
}

export async function validateSignedReleaseBundle(
  bundle: string,
): Promise<void> {
  const signature = await spawn('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    '-R',
    RELEASE_DESIGNATED_REQUIREMENT,
    bundle,
  ])
  if (signature.code !== 0) {
    throw new Error(
      `Signed application validation failed at ${bundle}; expected the canonical Developer ID signature. Sign the complete bundle before notarization.`,
    )
  }
  await validateReleaseBundleMetadata(bundle)
}

export async function createNotaryArchive(
  bundle: string,
  output: string,
): Promise<void> {
  const result = await spawn(
    '/usr/bin/ditto',
    ['-c', '-k', '--norsrc', '--keepParent', bundle, output],
    { cwd: REPO_ROOT },
  )
  if (result.code !== 0) {
    throw new Error(
      `Release archive creation failed at ${output}; expected a clean ZIP of ${bundle}. Remove the partial output and retry.`,
    )
  }
}

export async function prepareNotarySubmission(
  bundle: string,
  submission: string,
  resume: string | undefined,
  statePaths: readonly string[],
): Promise<string> {
  if (resume === undefined && statePaths.some(existsSync)) {
    throw new Error(
      `Notarization state already exists for ${submission}; a fresh submission could duplicate an existing Apple job. Reconcile the recorded job and resume it explicitly.`,
    )
  }
  if (resume === undefined) {
    await createNotaryArchive(bundle, submission)
    await fs.chmod(submission, 0o600)
  } else if (!existsSync(submission)) {
    throw new Error(
      `Original notarization submission is missing at ${submission}; expected the retained bytes recorded by the receipt. Reconcile the Apple job before continuing.`,
    )
  }
  return releaseFileSha256(submission)
}

export async function resolveNotarySubmission(
  submission: string,
  submissionSha256: string,
  receiptPath: string,
  unresolvedPath: string,
  profile: string,
  keychain: string | undefined,
  resume: string | undefined,
  bundleIdentity: ReleaseBundleIdentity,
): Promise<string> {
  if (resume !== undefined) {
    const receipt = parseNotaryReceipt(
      JSON.parse(await fs.readFile(resume, 'utf8')),
    )
    if (
      receipt.submissionSha256 !== submissionSha256 ||
      !releaseBundleIdentitiesMatch(receipt, bundleIdentity)
    ) {
      throw new Error(
        `Notary receipt digest mismatch for ${submission}; expected the original submitted bytes. Resume with the matching retained archive.`,
      )
    }
    await waitForNotarySubmission(receipt.submissionId, { keychain, profile })
    return receipt.submissionId
  }
  let submissionId: string
  try {
    submissionId = await submitNotaryArchive({
      archive: submission,
      keychain,
      profile,
    })
  } catch (error) {
    const knownId =
      error instanceof NotarySubmissionError ? error.submissionId : undefined
    await writeNotaryReceipt(
      knownId === undefined ? unresolvedPath : receiptPath,
      {
        ...bundleIdentity,
        ...(knownId === undefined ? {} : { submissionId: knownId }),
        status: knownId === undefined ? 'unresolved' : 'interrupted',
        submissionSha256,
      },
    )
    throw error
  }
  await writeNotaryReceipt(receiptPath, {
    ...bundleIdentity,
    status: 'submitted',
    submissionId,
    submissionSha256,
  })
  await waitForNotarySubmission(submissionId, { keychain, profile })
  return submissionId
}

export async function notarizeReleaseBundle(
  bundle: string,
  output: string,
  profile: string,
  options: {
    keychain?: string | undefined
    resume?: string | undefined
  } = {},
): Promise<void> {
  const { keychain, resume } = {
    __proto__: null,
    ...options,
  } as typeof options
  const evidence = releaseNotaryEvidencePaths(output)
  const submission = evidence.submission
  const working = releaseNotaryWorkingPaths(output, crypto.randomUUID())
  const finalArchive = working.finalArchive
  const finalSidecar = working.finalSidecar
  const receiptPath = evidence.receipt
  const unresolvedPath = working.unresolved
  const logPath = evidence.log
  try {
    await validateSignedReleaseBundle(bundle)
    const bundleIdentity = await readReleaseBundleIdentity(bundle)
    const submissionSha256 = await prepareNotarySubmission(
      bundle,
      submission,
      resume,
      [output, receiptPath, unresolvedPath, submission, logPath],
    )
    const submissionId = await resolveNotarySubmission(
      submission,
      submissionSha256,
      receiptPath,
      unresolvedPath,
      profile,
      keychain,
      resume,
      bundleIdentity,
    )
    const log = await inspectNotaryLog(submissionId, submissionSha256, {
      keychain,
      profile,
    })
    await fs.writeFile(logPath, log.json, { mode: 0o600 })
    await runXcrun(['stapler', 'staple', bundle])
    await runXcrun(['stapler', 'validate', bundle])
    await createNotaryArchive(bundle, finalArchive)
    const archiveSha256 = await releaseFileSha256(finalArchive)
    await fs.writeFile(
      finalSidecar,
      `${archiveSha256}  ${path.basename(finalArchive)}\n`,
      { mode: 0o600 },
    )
    const verification = await spawn(
      'pnpm',
      ['run', 'verify-release', finalArchive],
      { cwd: REPO_ROOT },
    )
    if (verification.code !== 0) {
      throw new Error(
        `Final release verification failed at ${finalArchive}; no release output was written. Resolve the packaged artifact before publication.`,
      )
    }
    await fs.rename(finalArchive, output)
    try {
      await writeCompletedNotaryReceipt(receiptPath, {
        archive: output,
        archiveSha256,
        assessmentResult: 'accepted',
        codesignResult: 'passed',
        logSha256: log.sha256,
        stapleResult: 'validated',
        submissionId,
        submissionSha256,
      })
    } catch (error) {
      await safeDelete(output)
      throw error
    }
    await safeDelete(unresolvedPath)
    logger.success(
      `Notarized ${path.basename(bundle)} as ${path.basename(output)}; submission ${submissionId}; log SHA-256 ${log.sha256}`,
    )
  } finally {
    await safeDelete(finalArchive)
    await safeDelete(finalSidecar)
  }
}

export async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Sockeye notarization refused on ${process.platform}; notarytool requires macOS. Run the signing workflow on macOS.`,
    )
  }
  const { values } = parseArgs({
    args: getScriptArgs(),
    options: {
      bundle: { type: 'string' },
      help: { default: false, type: 'boolean' },
      keychain: { type: 'string' },
      'keychain-profile': { type: 'string' },
      output: { type: 'string' },
      resume: { type: 'string' },
      run: { default: false, type: 'boolean' },
    },
    strict: true,
  })
  if (
    values['help'] ||
    values['bundle'] === undefined ||
    values['output'] === undefined
  ) {
    logger.log(SCRIPT_META.help)
    if (!values['help']) {
      process.exitCode = 1
    }
    return
  }
  const configuredProfile =
    values['keychain-profile'] ?? getEnvValue(NOTARY_PROFILE_ENV)
  const profile = configuredProfile ?? `$${NOTARY_PROFILE_ENV}`
  const bundle = path.resolve(values['bundle'])
  const output = path.resolve(values['output'])
  if (values['run'] !== true) {
    const submission = path.join('$TMPDIR', 'sockeye-notary', 'submission.zip')
    logger.log('Dry run; no files or remote state changed.')
    logger.log(
      displayCommand('/usr/bin/ditto', [
        '-c',
        '-k',
        '--norsrc',
        '--keepParent',
        bundle,
        submission,
      ]),
    )
    logger.log(
      displayCommand(
        '/usr/bin/xcrun',
        notarySubmissionArgs({
          archive: submission,
          keychain: values['keychain'],
          profile,
        }),
      ),
    )
    logger.log('/usr/bin/xcrun notarytool log <submission-id> ...')
    logger.log(`/usr/bin/xcrun stapler staple ${bundle}`)
    logger.log(`/usr/bin/xcrun stapler validate ${bundle}`)
    logger.log(`Package the stapled app atomically as ${output}.`)
    return
  }
  if (configuredProfile === undefined) {
    throw new Error(
      `Notary keychain profile is missing; set ${NOTARY_PROFILE_ENV} or pass --keychain-profile. Store credentials before this release step.`,
    )
  }
  if (!existsSync(bundle) || path.extname(bundle).toLowerCase() !== '.app') {
    throw new Error(
      `Signed application bundle is missing at ${bundle}; expected a .app directory. Build and sign Sockeye before notarization.`,
    )
  }
  await fs.mkdir(path.dirname(output), { recursive: true })
  await notarizeReleaseBundle(bundle, output, configuredProfile, {
    keychain: values['keychain'],
    resume: values['resume'],
  })
}

if (isMainModule(import.meta.url)) {
  runMain(
    () =>
      main().catch((error: unknown) => {
        logger.fail(`Sockeye notarization failed: ${errorMessage(error)}`)
        process.exitCode = 1
      }),
    SCRIPT_META,
  )
}
