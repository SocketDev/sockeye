#!/usr/bin/env node
import { parseArgs } from 'node:util'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import type { ScriptResult } from '../fleet/process/script-result.mts'
import {
  getScriptArgs,
  getScriptLogger,
} from '../fleet/process/script-output.mts'
import { REPO_ROOT } from '../fleet/paths.mts'

const logger = getScriptLogger()
const WORKFLOW = 'repo-sign-macos.yml'

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Dispatch the signed macOS workflow after exact remote-SHA validation.',
  help: 'Usage: pnpm run sign:workflow --run [--ref <branch>] [--adhoc]\n\nWithout --run, validate and report the target without dispatching.',
  json: 'result',
}

interface WorkflowRun {
  databaseId: number
  headSha: string
  status: string
  url: string
}

export function parseJsonObject(
  stdout: string,
  action: string,
): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    throw new Error(
      `GitHub ${action} failed; expected JSON metadata. Run pnpm run gh:auth and retry.`,
    )
  }
  if (!isPlainObject(value)) {
    throw new Error(
      `GitHub ${action} failed; expected one metadata object. Run pnpm run gh:auth and retry.`,
    )
  }
  return value
}

export async function runGh(args: string[]): Promise<string> {
  const result = await spawn('gh', args, { cwd: REPO_ROOT, stdio: 'pipe' })
  if (result.code !== 0) {
    throw new Error(
      `GitHub command failed during ${args.slice(0, 2).join(' ')}. Run pnpm run gh:auth and retry.`,
    )
  }
  return `${result.stdout ?? ''}`
}

export function selectSigningWorkflowRun(
  value: unknown,
  expectedSha: string,
  minimumRunId = 0,
): WorkflowRun | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const candidate = value.find(
    item =>
      isPlainObject(item) &&
      item['headSha'] === expectedSha &&
      typeof item['databaseId'] === 'number' &&
      item['databaseId'] > minimumRunId &&
      typeof item['status'] === 'string' &&
      typeof item['url'] === 'string',
  )
  if (!isPlainObject(candidate)) {
    return undefined
  }
  return {
    databaseId: candidate['databaseId'] as number,
    headSha: candidate['headSha'] as string,
    status: candidate['status'] as string,
    url: candidate['url'] as string,
  }
}

export async function listSigningWorkflowRuns(
  repository: string,
  branch: string,
): Promise<unknown> {
  return JSON.parse(
    await runGh([
      'run',
      'list',
      '--repo',
      repository,
      '--workflow',
      WORKFLOW,
      '--branch',
      branch,
      '--event',
      'workflow_dispatch',
      '--limit',
      '20',
      '--json',
      'databaseId,headSha,status,url',
    ]),
  )
}

export function latestWorkflowRunId(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0
  }
  return Math.max(
    0,
    ...value.map(item =>
      isPlainObject(item) && typeof item['databaseId'] === 'number'
        ? item['databaseId']
        : 0,
    ),
  )
}

export async function waitForDispatchedRun(
  repository: string,
  branch: string,
  expectedSha: string,
  minimumRunId: number,
): Promise<WorkflowRun> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const selected = selectSigningWorkflowRun(
      await listSigningWorkflowRuns(repository, branch),
      expectedSha,
      minimumRunId,
    )
    if (selected !== undefined) {
      return selected
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(
    `GitHub accepted the signing dispatch for ${expectedSha}, but its run did not appear within 20 seconds. Inspect ${WORKFLOW} before dispatching again.`,
  )
}

export async function main(): Promise<ScriptResult> {
  const { values } = parseArgs({
    args: getScriptArgs(),
    options: {
      adhoc: { default: false, type: 'boolean' },
      ref: { type: 'string' },
      run: { default: false, type: 'boolean' },
    },
    strict: true,
  })
  const repositoryMetadata = parseJsonObject(
    await runGh(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']),
    'repository lookup',
  )
  const defaultBranch = repositoryMetadata['defaultBranchRef']
  const repository = repositoryMetadata['nameWithOwner']
  if (
    typeof defaultBranch !== 'object' ||
    defaultBranch === null ||
    typeof repository !== 'string'
  ) {
    throw new Error(
      'GitHub repository lookup failed; expected a repository name and default branch. Run pnpm run gh:auth and retry.',
    )
  }
  const branch =
    values['ref'] ?? (defaultBranch as Record<string, unknown>)['name']
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new Error(
      'GitHub repository lookup failed; expected a nonempty target branch. Pass --ref or repair the repository default branch.',
    )
  }
  const local = await spawn('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
  const localSha = `${local.stdout ?? ''}`.trim()
  const remote = parseJsonObject(
    await runGh(['api', `repos/${repository}/git/ref/heads/${branch}`]),
    'branch lookup',
  )
  const remoteObject = remote['object']
  const remoteSha = isPlainObject(remoteObject)
    ? remoteObject['sha']
    : undefined
  if (!/^[a-f0-9]{40}$/u.test(localSha) || remoteSha !== localSha) {
    throw new Error(
      `Signing dispatch refused for ${branch}; local HEAD is ${localSha || 'unavailable'} and the remote branch is ${typeof remoteSha === 'string' ? remoteSha : 'unavailable'}. Push the exact commit before dispatch.`,
    )
  }
  if (values['run'] !== true) {
    logger.info(
      `Signing workflow target is ${repository}@${branch} (${localSha}).`,
    )
    return { data: { branch, repository, sha: localSha }, exitCode: 0 }
  }
  const minimumRunId = latestWorkflowRunId(
    await listSigningWorkflowRuns(repository, branch),
  )
  await runGh([
    'workflow',
    'run',
    WORKFLOW,
    '--repo',
    repository,
    '--ref',
    branch,
    '-f',
    `adhoc=${values['adhoc'] === true ? 'true' : 'false'}`,
  ])
  const run = await waitForDispatchedRun(
    repository,
    branch,
    localSha,
    minimumRunId,
  )
  logger.success(
    `Signing workflow ${run.databaseId} targets ${localSha}: ${run.url}`,
  )
  return { data: { ...run, branch, repository }, exitCode: 0 }
}

if (isMainModule(import.meta.url)) {
  runMain(
    () =>
      main().catch((error: unknown) => {
        throw new Error(
          `Sockeye signing workflow failed: ${errorMessage(error)}`,
        )
      }),
    SCRIPT_META,
  )
}
