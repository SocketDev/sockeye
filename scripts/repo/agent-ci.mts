#!/usr/bin/env node
/**
 * @file Launch one explicit Agent-CI workflow through Sockeye. This process
 *   handles credential names and public variable values only. Sockeye reads
 *   secret values after Touch ID and places them directly in the approved
 *   child environment.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  buildSockeyeAgentCiArguments,
  normalizeAgentCiArguments,
  requestedWorkflowCredentials,
} from './agent-ci-contract.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import { getBinaryPath } from './paths.mts'

const logger = getDefaultLogger()
const require = createRequire(import.meta.url)

function workflowArgument(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!
    if (value === '--workflow' || value === '-w') {
      return args[index + 1]
    }
    if (value.startsWith('--workflow=')) {
      return value.slice('--workflow='.length)
    }
    if (value.startsWith('-w=')) {
      return value.slice(3)
    }
  }
  return undefined
}

function agentCiFiles(): { entry: string; files: string[] } {
  const packageJson = require.resolve('@redwoodjs/agent-ci/package.json')
  const packageRoot = path.dirname(packageJson)
  const dist = path.join(packageRoot, 'dist')
  const files = readdirSync(dist, { recursive: true })
    .filter(value => typeof value === 'string' && value.endsWith('.js'))
    .map(value => path.join(dist, String(value)))
  return {
    entry: path.join(dist, 'native-launcher.js'),
    files: [packageJson, ...files],
  }
}

async function main(): Promise<void> {
  const agentArguments = normalizeAgentCiArguments(process.argv.slice(2))
  if (agentArguments[0] !== 'run') {
    throw new Error('Sockeye integration supports only `agent-ci run`')
  }
  if (agentArguments.includes('--all') || agentArguments.includes('-a')) {
    throw new Error(
      'Choose one --workflow so Sockeye can request only that workflow’s credentials',
    )
  }
  const requestedWorkflow = workflowArgument(agentArguments)
  if (!requestedWorkflow || requestedWorkflow.endsWith('.lock.yml')) {
    throw new Error(
      'Pass one non-gh-aw workflow with --workflow <path>; compiled .lock.yml files are unsupported',
    )
  }
  const workflow = path.resolve(REPO_ROOT, requestedWorkflow)
  const workflowsRoot = path.join(REPO_ROOT, '.github', 'workflows')
  if (
    workflow !== workflowsRoot &&
    !workflow.startsWith(`${workflowsRoot}${path.sep}`)
  ) {
    throw new Error('The workflow path must stay under .github/workflows')
  }
  if (!existsSync(workflow)) {
    throw new Error(`Workflow does not exist: ${requestedWorkflow}`)
  }

  const contract = requestedWorkflowCredentials(readFileSync(workflow, 'utf8'))
  const agentCi = agentCiFiles()
  const mode = process.env['BUILD_MODE'] ?? 'dev'
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
    repoRoot: REPO_ROOT,
    secrets: contract.secrets,
    variables: contract.variables,
  })

  logger.info(
    `Requesting ${contract.secrets.length} secret(s) and ${contract.variables.length} non-secret variable(s) for ${requestedWorkflow}`,
  )
  const result = await spawn(sockeye, sockeyeArguments, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  process.exitCode = result.code ?? 1
}

main().catch((error: unknown) => {
  logger.fail(`Sockeye Agent-CI launch failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
