/**
 * @file Pure Agent-CI contract helpers. They identify only the workflow names
 *   that Agent-CI will request and build Sockeye arguments without ever
 *   accepting credential values.
 */

const REFERENCE = /\b(?<kind>secrets|vars)\.(?<name>[A-Z][A-Z0-9_]*)\b/gu

/**
 * Pnpm preserves its conventional argument separator when it starts a Node
 * script. Remove that one transport marker before validating Agent-CI's own
 * command line; any later `--` remains part of the requested command.
 */
export function normalizeAgentCiArguments(
  arguments_: readonly string[],
): readonly string[] {
  return arguments_[0] === '--' ? arguments_.slice(1) : arguments_
}

export interface WorkflowCredentialContract {
  readonly secrets: readonly string[]
  readonly variables: readonly string[]
}

export function requestedWorkflowCredentials(
  workflowText: string,
): WorkflowCredentialContract {
  const secrets = new Set<string>()
  const variables = new Set<string>()
  for (const match of workflowText.matchAll(REFERENCE)) {
    const name = match.groups!['name']!
    if (match.groups!['kind'] === 'secrets') {
      secrets.add(name)
    } else {
      variables.add(name)
    }
  }
  return {
    secrets: [...secrets].toSorted(),
    variables: [...variables].toSorted(),
  }
}

export function buildSockeyeAgentCiArguments(input: {
  readonly agentArguments: readonly string[]
  readonly agentCiEntry: string
  readonly boundFiles: readonly string[]
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly nodeExecutable: string
  readonly repoRoot: string
  readonly secrets: readonly string[]
  readonly variables: readonly string[]
}): string[] {
  const args = ['run']
  for (const secret of input.secrets) {
    if (secret !== 'GITHUB_TOKEN') {
      args.push('--credential', secret)
    }
  }
  for (const name of ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER']) {
    if (input.environment[name] !== undefined) {
      args.push('--pass-env', name)
    }
  }
  const boundFiles = input.boundFiles.toSorted()
  for (let index = 0, { length } = boundFiles; index < length; index += 1) {
    args.push('--bind-file', boundFiles[index]!)
  }
  args.push('--cwd', input.repoRoot, '--', input.nodeExecutable)
  args.push(input.agentCiEntry, ...input.agentArguments)
  for (const variable of input.variables) {
    const value = input.environment[variable]
    if (value === undefined) {
      throw new Error(`Missing non-secret workflow variable ${variable}`)
    }
    args.push('--var', `${variable}=${value}`)
  }
  return args
}
