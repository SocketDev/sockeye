#!/usr/bin/env node
import {
  getScriptArgs,
  getScriptLogger,
  scriptStdio,
} from '../fleet/process/script-output.mts'
/**
 * @file Launch one explicit Agent-CI workflow through Sockeye. This process
 *   handles credential names and public variable values only. Sockeye reads
 *   secret values after Touch ID and places them directly in the approved
 *   child environment.
 */

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  buildSockeyeAgentCiArguments,
  parseAgentCiRequest,
  requestedWorkflowCredentials,
} from './agent-ci-contract.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import {
  getAgentCiDistFile,
  getAgentCiPackagePaths,
  getBinaryPath,
  getBuildMode,
} from './paths.mts'

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Launch one Local CI workflow through the Sockeye credential broker.',
  help: `Usage: pnpm run ci:sockeye -- run --workflow .github/workflows/ci.yml [--repository <absolute-path>] [--var NAME=value] [--quiet] [--pause-on-failure] [--github-token] [--json]
Supply each declared public workflow variable with --var NAME=value. Secret values come from Sockeye Keychain storage after Touch ID.
The bridge rejects other workflow selectors, environment files, and secret override or variable-file flags.`,
  json: 'result',
}

const logger = getScriptLogger()

export function resolveAgentCiWorkflow(
  repository: string,
  requested: string,
): string {
  const root = realpathSync(repository)
  const workflow = path.resolve(root, requested)
  const relative = normalizePath(path.relative(root, workflow))
  if (
    !relative.startsWith('.github/workflows/') ||
    !/\.ya?ml$/u.test(relative) ||
    relative.endsWith('.lock.yml')
  ) {
    throw new Error(
      'Select one non-gh-aw YAML workflow under .github/workflows',
    )
  }
  let current = root
  const segments = relative.split('/')
  for (let index = 0, { length } = segments; index < length; index += 1) {
    const segment = segments[index]!
    current = path.join(current, segment)
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('Workflow paths must not contain symlinks')
    }
  }
  if (!lstatSync(workflow).isFile() || realpathSync(workflow) !== workflow) {
    throw new Error('Workflow must be a regular repository file')
  }
  for (const filename of ['.env.local-ci', '.env.agent-ci']) {
    if (existsSync(path.join(root, filename))) {
      throw new Error(
        'Remove Local CI environment files before using the Sockeye credential bridge',
      )
    }
  }
  return workflow
}

export function agentCiFiles(repository: string): {
  entry: string
  files: string[]
} {
  const { dist, entry, packageJson } = getAgentCiPackagePaths(repository)
  const files = readdirSync(dist, { recursive: true })
    .filter(value => typeof value === 'string' && value.endsWith('.js'))
    .map(value => getAgentCiDistFile(dist, String(value)))
  return {
    entry,
    files: [packageJson, ...files],
  }
}

async function main(): Promise<void> {
  const request = parseAgentCiRequest(getScriptArgs())
  if (
    request.repository !== undefined &&
    !path.isAbsolute(request.repository)
  ) {
    throw new Error('--repository requires an absolute repository path')
  }
  const repository = realpathSync(request.repository ?? REPO_ROOT)
  const workflow = resolveAgentCiWorkflow(repository, request.workflow)
  const agentArguments = [
    'run',
    '--workflow',
    workflow,
    ...request.arguments.slice(3),
  ]
  const contract = requestedWorkflowCredentials(readFileSync(workflow, 'utf8'))
  const agentCi = agentCiFiles(repository)
  const mode = getBuildMode()
  const sockeye = getBinaryPath(mode, `${process.platform}-${process.arch}`)
  if (!existsSync(sockeye)) {
    throw new Error('Build Sockeye first with `pnpm run build`')
  }
  const sockeyeArguments = buildSockeyeAgentCiArguments({
    agentArguments,
    agentCiEntry: agentCi.entry,
    boundFiles: [workflow, ...agentCi.files],
    environment: process.env,
    nodeExecutable: process.execPath,
    repoRoot: repository,
    secrets: contract.secrets,
    variables: contract.variables,
    variableValues: request.variableValues,
  })

  logger.info(
    `Requesting ${contract.secrets.length} secret(s) and ${contract.variables.length} non-secret variable(s) for ${workflow}`,
  )
  const result = await spawn(sockeye, sockeyeArguments, {
    cwd: repository,
    stdio: scriptStdio('inherit'),
  })
  process.exitCode = result.code ?? 1
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
