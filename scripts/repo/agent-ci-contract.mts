import { parseArgs } from 'node:util'
import { parseDocument } from 'yaml'

/**
 * @file Pure Agent-CI contract helpers. They identify only the workflow names
 *   that Agent-CI will request and build Sockeye arguments without ever
 *   accepting credential values.
 */

export interface AgentCiRequest {
  readonly repository?: string | undefined
  readonly workflow: string
  readonly variableValues: Readonly<Record<string, string>>
  readonly arguments: readonly string[]
}

function parseAgentCiOptions(argv: readonly string[]) {
  return parseArgs({
    args: [...normalizeAgentCiArguments(argv)],
    allowPositionals: true,
    strict: true,
    options: {
      workflow: { type: 'string', short: 'w', multiple: true },
      repository: { type: 'string', multiple: true },
      var: { type: 'string', multiple: true },
      'github-token': { type: 'boolean' },
      json: { type: 'boolean' },
      'pause-on-failure': { type: 'boolean' },
      quiet: { type: 'boolean' },
    },
  })
}

function parseAgentCiVariables(
  values: readonly string[],
): Record<string, string> {
  const variables: Record<string, string> = Object.create(null)
  for (const value of values) {
    const separator = value.indexOf('=')
    const name = value.slice(0, separator)
    if (
      separator < 1 ||
      !/^[A-Z_][A-Z0-9_]*$/u.test(name) ||
      Object.hasOwn(variables, name)
    ) {
      throw new Error(
        'Public variables require unique --var UPPERCASE_NAME=value arguments',
      )
    }
    variables[name] = value.slice(separator + 1)
  }
  return variables
}

export function parseAgentCiRequest(argv: readonly string[]): AgentCiRequest {
  let parsed: ReturnType<typeof parseAgentCiOptions>
  try {
    parsed = parseAgentCiOptions(argv)
  } catch {
    throw new Error(
      'Unsupported Local CI argument; use one workflow and explicit safe run flags',
    )
  }
  const { values, positionals } = parsed
  if (positionals.length !== 1 || positionals[0] !== 'run') {
    throw new Error('Sockeye supports only local-ci run')
  }
  if (values.workflow?.length !== 1 || (values.repository?.length ?? 0) > 1) {
    throw new Error(
      'Pass exactly one workflow and at most one repository selector',
    )
  }
  const workflow = values.workflow[0]!
  const repository = values.repository?.[0]
  if (!workflow || workflow.endsWith('.lock.yml') || repository === '') {
    throw new Error('Pass one non-gh-aw workflow with --workflow <path>')
  }
  const flags: string[] = []
  for (const flag of [
    'github-token',
    'json',
    'pause-on-failure',
    'quiet',
  ] as const) {
    if (values[flag]) {
      flags.push(`--${flag}`)
    }
  }
  const variableValues = parseAgentCiVariables(values.var ?? [])
  return {
    repository,
    workflow,
    variableValues,
    arguments: ['run', '--workflow', workflow, ...flags],
  }
}

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

function workflowExpressionTokens(expression: string): string[] {
  const tokens: string[] = []
  let index = 0
  while (index < expression.length) {
    const character = expression[index]!
    if (/\s/u.test(character)) {
      index += 1
      continue
    }
    if (character === "'" || character === '"') {
      const start = index
      index += 1
      let closed = false
      while (index < expression.length) {
        if (expression[index] === character) {
          index += 1
          if (expression[index] === character) {
            index += 1
            continue
          }
          closed = true
          break
        }
        index += 1
      }
      if (!closed) {
        throw new Error('Workflow expression contains an unterminated string')
      }
      tokens.push(expression.slice(start, index))
    } else if (/[A-Za-z_]/u.test(character)) {
      const start = index
      index += 1
      while (
        index < expression.length &&
        /[A-Za-z0-9_-]/u.test(expression[index]!)
      ) {
        index += 1
      }
      tokens.push(expression.slice(start, index))
    } else {
      tokens.push(character)
      index += 1
    }
  }
  return tokens
}

function workflowExpressions(value: string): string[] {
  const expressions: string[] = []
  let offset = 0
  while (offset < value.length) {
    const start = value.indexOf('${{', offset)
    if (start < 0) {
      break
    }
    let quote: string | undefined
    let index = start + 3
    for (; index < value.length; index += 1) {
      const character = value[index]!
      if (quote) {
        if (character === quote) {
          if (value[index + 1] === quote) {
            index += 1
          } else {
            quote = undefined
          }
        }
      } else if (character === "'" || character === '"') {
        quote = character
      } else if (character === '}' && value[index + 1] === '}') {
        break
      }
    }
    if (index === value.length) {
      throw new Error('Workflow expression is unterminated')
    }
    expressions.push(value.slice(start + 3, index))
    offset = index + 2
  }
  return expressions
}

function collectWorkflowReferences(
  expression: string,
  secrets: Set<string>,
  variables: Set<string>,
): void {
  const tokens = workflowExpressionTokens(expression)
  for (let index = 0; index < tokens.length; index += 1) {
    const context = tokens[index]!
    if (
      !['secrets', 'vars'].includes(context.toLowerCase()) ||
      tokens[index - 1] === '.'
    ) {
      continue
    }
    let name: string | undefined
    if (tokens[index + 1] === '.') {
      name = tokens[index + 2]
      index += 2
    } else if (tokens[index + 1] === '[' && tokens[index + 3] === ']') {
      const literal = tokens[index + 2]!
      if (
        (literal.startsWith("'") && literal.endsWith("'")) ||
        (literal.startsWith('"') && literal.endsWith('"'))
      ) {
        name = literal.slice(1, -1)
      }
      index += 3
    }
    if (
      !['secrets', 'vars'].includes(context) ||
      !name ||
      !/^[A-Z_][A-Z0-9_]*$/u.test(name)
    ) {
      throw new Error('Workflow uses an unsupported credential reference')
    }
    if (context === 'secrets') {
      secrets.add(name)
    } else {
      variables.add(name)
    }
  }
}

export function requestedWorkflowCredentials(
  workflowText: string,
): WorkflowCredentialContract {
  const secrets = new Set<string>()
  const variables = new Set<string>()
  const document = parseDocument(workflowText, { uniqueKeys: true })
  if (document.errors.length) {
    throw new Error('Workflow YAML is invalid')
  }
  const pending: unknown[] = [document.toJS({ maxAliasCount: 0 })]
  while (pending.length) {
    const value = pending.pop()
    if (Array.isArray(value)) {
      pending.push(...value)
    } else if (value !== null && typeof value === 'object') {
      pending.push(...Object.values(value))
    } else if (typeof value === 'string') {
      for (const expression of workflowExpressions(value)) {
        collectWorkflowReferences(expression, secrets, variables)
      }
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
  readonly variableValues: Readonly<Record<string, string>>
}): string[] {
  if (
    Object.keys(input.variableValues).some(
      name => !input.variables.includes(name),
    )
  ) {
    throw new Error(
      'A supplied public variable is not declared by the selected workflow',
    )
  }
  if (
    input.secrets.some(
      name =>
        /^(?:AGENT_CI_|DYLD_|LD_|LOCAL_CI_|NODE_)/u.test(name) ||
        ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER'].includes(name),
    )
  ) {
    throw new Error(
      'Workflow secret names must not override runner or loader configuration',
    )
  }
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
    const value = input.variableValues[variable]
    if (!Object.hasOwn(input.variableValues, variable) || value === undefined) {
      throw new Error(`Missing non-secret workflow variable ${variable}`)
    }
    args.push('--var', `${variable}=${value}`)
  }
  return args
}
