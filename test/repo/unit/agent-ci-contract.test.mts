/**
 * @file The Agent-CI bridge must derive a least-privilege name set and must
 *   never accept secret values while constructing the Sockeye launch.
 */

import { expect, test } from 'vitest'

import {
  buildSockeyeAgentCiArguments,
  normalizeAgentCiArguments,
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
      SOCKET_RELEASE_CLIENT_ID: 'public-client-id',
    },
    nodeExecutable: '/usr/bin/node',
    repoRoot: '/repo',
    secrets: ['GITHUB_TOKEN', 'SOCKET_RELEASE_APP_PRIVATE_KEY'],
    variables: ['SOCKET_RELEASE_CLIENT_ID'],
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
    }),
  ).toThrow(/SOCKET_RELEASE_CLIENT_ID/u)
})
