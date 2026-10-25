/**
 * @file The Agent-CI bridge must derive a least-privilege name set and must
 *   never accept secret values while constructing the Sockeye launch.
 */

import { expect, test } from 'vitest'

import {
  buildSockeyeAgentCiArguments,
  normalizeAgentCiArguments,
  parseAgentCiRequest,
  requestedWorkflowCredentials,
} from '../../../scripts/repo/agent-ci-contract.mts'

test("removes only pnpm's leading argument separator", () => {
  expect(
    normalizeAgentCiArguments(['--', 'run', '--workflow', 'ci.yml']),
  ).toEqual(['run', '--workflow', 'ci.yml'])
  expect(normalizeAgentCiArguments(['run', '--', '--quiet'])).toEqual([
    'run',
    '--',
    '--quiet',
  ])
})

test('extracts unique workflow secret and variable names', () => {
  const contract = requestedWorkflowCredentials(`
    client-id: \${{ vars.SOCKET_RELEASE_CLIENT_ID }}
    private-key: \${{ secrets.SOCKET_RELEASE_APP_PRIVATE_KEY }}
    again: \${{ secrets.SOCKET_RELEASE_APP_PRIVATE_KEY }}
  `)
  expect(contract).toEqual({
    secrets: ['SOCKET_RELEASE_APP_PRIVATE_KEY'],
    variables: ['SOCKET_RELEASE_CLIENT_ID'],
  })
})

test('passes only secret names and explicit public variable values', () => {
  const args = buildSockeyeAgentCiArguments({
    agentArguments: ['run', '--workflow', '.github/workflows/release.yml'],
    agentCiEntry: '/repo/node_modules/agent-ci/dist/native-launcher.js',
    boundFiles: ['/repo/.github/workflows/release.yml'],
    environment: {
      HOME: '/home/test',
    },
    nodeExecutable: '/usr/bin/node',
    repoRoot: '/repo',
    secrets: ['GITHUB_TOKEN', 'SOCKET_RELEASE_APP_PRIVATE_KEY'],
    variables: ['SOCKET_RELEASE_CLIENT_ID'],
    variableValues: { SOCKET_RELEASE_CLIENT_ID: 'public-client-id' },
  })
  expect(args).toContain('SOCKET_RELEASE_APP_PRIVATE_KEY')
  expect(args).not.toContain('GITHUB_TOKEN')
  expect(args).toContain('SOCKET_RELEASE_CLIENT_ID=public-client-id')
  expect(args.join('\n')).not.toContain('private-key-bytes')
})

test('fails closed when a requested public variable is absent', () => {
  expect(() =>
    buildSockeyeAgentCiArguments({
      agentArguments: ['run'],
      agentCiEntry: '/agent-ci.js',
      boundFiles: [],
      environment: {},
      nodeExecutable: '/node',
      repoRoot: '/repo',
      secrets: [],
      variables: ['SOCKET_RELEASE_CLIENT_ID'],
      variableValues: {},
    }),
  ).toThrow(/SOCKET_RELEASE_CLIENT_ID/u)
})

test('accepts one explicit workflow and strips the broker repository option', () => {
  expect(
    parseAgentCiRequest([
      '--',
      'run',
      '--repository=/example/repository',
      '-w',
      '.github/workflows/ci.yml',
      '--github-token',
      '--quiet',
    ]),
  ).toEqual({
    repository: '/example/repository',
    workflow: '.github/workflows/ci.yml',
    variableValues: {},
    arguments: [
      'run',
      '--workflow',
      '.github/workflows/ci.yml',
      '--github-token',
      '--quiet',
    ],
  })
})

test('rejects duplicate selectors and unbound Local CI input flags', () => {
  const prefix = ['run', '--workflow', '.github/workflows/ci.yml']
  for (const suffix of [
    ['-w', '.github/workflows/other.yml'],
    ['--workflow=other.yml'],
    ['--all'],
    ['--all=true'],
    ['-a'],
    ['-aq'],
    ['--secret', 'EXAMPLE_KEY=example'],
    ['--secret-file', 'example.json'],
    ['--var-file', 'example.json'],
    ['--var', 'missing-equals'],
    ['--var', 'EXAMPLE=value', '--var', 'EXAMPLE=duplicate'],
    ['--repository=/example', '--repository=/other'],
    ['--', '--all'],
  ])
    expect(() => parseAgentCiRequest([...prefix, ...suffix])).toThrow()
  for (const args of [
    [],
    ['retry'],
    ['run'],
    ['run', '-w'],
    ['run', '-w', '--all'],
    ['run', '-w', '.github/workflows/example.lock.yml'],
  ]) {
    expect(() => parseAgentCiRequest(args)).toThrow()
  }
})

test('ignores YAML comments and resolves literal indexed credential names', () => {
  expect(
    requestedWorkflowCredentials(`
# unused: \${{ secrets.UNUSED_KEY }}
client: \${{ vars['EXAMPLE_CLIENT_ID'] }}
private: \${{ secrets["EXAMPLE_PRIVATE_KEY"] }}
`),
  ).toEqual({
    secrets: ['EXAMPLE_PRIVATE_KEY'],
    variables: ['EXAMPLE_CLIENT_ID'],
  })
})

test('rejects dynamic credential contexts and invalid workflow YAML', () => {
  for (const value of [
    '\${{ secrets[inputs.key] }}',
    '\${{ toJSON(secrets) }}',
    '\${{ vars[inputs.key] }}',
  ]) {
    expect(() => requestedWorkflowCredentials(`value: ${value}`)).toThrow()
  }
  expect(() => requestedWorkflowCredentials('value: [')).toThrow()
})

test('accepts explicit public variables including empty values and embedded equals', () => {
  const request = parseAgentCiRequest([
    'run',
    '-w',
    '.github/workflows/ci.yml',
    '--var',
    'EXAMPLE_EMPTY=',
    '--var=EXAMPLE_URL=https://example.com/?key=value',
  ])
  expect(request.variableValues).toEqual({
    EXAMPLE_EMPTY: '',
    EXAMPLE_URL: 'https://example.com/?key=value',
  })
})

test('never sources public variables from ambient environment and rejects unknown inputs', () => {
  const input = {
    agentArguments: ['run'],
    agentCiEntry: '/example/runner.js',
    boundFiles: [],
    environment: { EXAMPLE_PRIVATE_KEY: 'ambient-placeholder' },
    nodeExecutable: '/example/node',
    repoRoot: '/example',
    secrets: [],
    variables: ['EXAMPLE_PRIVATE_KEY'],
    variableValues: {},
  }
  expect(() => buildSockeyeAgentCiArguments(input)).toThrow()
  expect(() =>
    buildSockeyeAgentCiArguments({
      ...input,
      variables: [],
      variableValues: { EXAMPLE_UNKNOWN: 'public' },
    }),
  ).toThrow()
  expect(
    buildSockeyeAgentCiArguments({
      ...input,
      variableValues: { EXAMPLE_PRIVATE_KEY: '' },
    }),
  ).toContain('EXAMPLE_PRIVATE_KEY=')
})

test('rejects credential names that could redirect Node or Local CI execution', () => {
  for (const name of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'LOCAL_CI_FORCE_RUST',
    'AGENT_CI_FORCE_RUST',
    'PATH',
  ]) {
    expect(() =>
      buildSockeyeAgentCiArguments({
        agentArguments: ['run'],
        agentCiEntry: '/example/runner.js',
        boundFiles: [],
        environment: {},
        nodeExecutable: '/example/node',
        repoRoot: '/example',
        secrets: [name],
        variables: [],
        variableValues: {},
      }),
    ).toThrow()
  }
})

test('does not interpret quoted expression strings or nested properties as credential contexts', () => {
  expect(
    requestedWorkflowCredentials(`
first: \${{ 'secrets.EXAMPLE_KEY' }}
second: \${{ format('secrets.{0}', 'EXAMPLE_KEY') }}
third: \${{ github.event.secrets.EXAMPLE_KEY }}
`),
  ).toEqual({ secrets: [], variables: [] })
})

test('rejects complete unsupported credential identifiers instead of matching uppercase prefixes', () => {
  for (const expression of [
    'secrets.EXAMPLE_KEYsuffix',
    'vars.EXAMPLE_VALUEsuffix',
    'secrets.EXAMPLE-KEY',
    "secrets['EXAMPLE_KEYsuffix']",
  ]) {
    expect(() =>
      requestedWorkflowCredentials(`value: \${{ ${expression} }}`),
    ).toThrow()
  }
})

test('keeps quoted delimiters and escaped quotes inside expression literals', () => {
  expect(
    requestedWorkflowCredentials(`
value: \${{ format('it''s }} secrets.EXAMPLE_UNUSED {0}', secrets.EXAMPLE_KEY) }}
`),
  ).toEqual({ secrets: ['EXAMPLE_KEY'], variables: [] })
})
