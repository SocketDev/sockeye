import { beforeAll, expect, test } from 'vitest'
import path from 'node:path'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  getNativeTestBinaryPath,
  getBuildMode,
  getCmakeBuildDir,
  REPO_ROOT,
} from '../../../scripts/repo/paths.mts'

const binary = getNativeTestBinaryPath('sockeye-main-effects-test')
const binding = 'a'.repeat(64)
const importBinding = 'b'.repeat(64)
const deleteBinding = 'c'.repeat(64)
const verifyBinding = 'd'.repeat(64)
beforeAll(() => {
  const object = path.join(
    getCmakeBuildDir(getBuildMode(), `${process.platform}-${process.arch}`),
    'CMakeFiles',
    'sockeye-main-effects-test.dir',
    'src',
    'sockeye',
    'main.cc.o',
  )
  const imports = spawnSync('xcrun', ['nm', '-u', object], { encoding: 'utf8' })
  expect(imports.status).toBe(0)
  expect(imports.stdout).not.toMatch(/_(?:setrlimit|signal|umask)\b/u)
  for (const name of ['Setrlimit', 'Signal', 'Umask']) {
    expect(imports.stdout).toContain(`_SockeyeMain${name}`)
  }
})
const commands: Record<string, string[]> = {
  set: ['set', 'EXAMPLE_TOKEN', '--binding', binding],
  delete: ['delete', 'EXAMPLE_TOKEN', '--binding', deleteBinding],
  verify: ['verify', 'EXAMPLE_TOKEN', '--binding', verifyBinding],
  import: [
    'import-1password',
    'EXAMPLE_TOKEN',
    'op://example-vault/example-item/password',
    '--binding',
    importBinding,
  ],
  run: [
    'run',
    '--credential',
    'EXAMPLE_TOKEN',
    '--binding',
    '0'.repeat(64),
    '--credential',
    'SECOND_TOKEN',
    '--binding',
    '1'.repeat(64),
    '--cwd',
    REPO_ROOT,
    '--',
    binary,
    'example-argument',
  ],
}

test.each([
  ['core-limit-failed', ['core']],
  ['signal-failed', ['core', 'signal']],
] as const)(
  'startup %s refuses before credential operations',
  (scenario, events) => {
    const result = spawnSync(binary, commands['delete'], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, SOCKEYE_TEST_SCENARIO: scenario },
    })
    expect(result.status).toBe(5)
    expect(result.stdout).toBe('')
    expect(
      [...result.stderr.matchAll(/^startup:(\w+)$/gm)].map(match => match[1]),
    ).toEqual(events)
    expect(result.stderr).not.toContain('effect:')
  },
)

test('successful startup establishes process restrictions before dispatch', () => {
  const result = spawnSync(binary, commands['delete'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, SOCKEYE_TEST_SCENARIO: 'success' },
  })
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('')
  expect(
    [...result.stderr.matchAll(/^(?:startup|effect):(\w+)$/gm)].map(
      match => match[1],
    ),
  ).toEqual([
    'core',
    'signal',
    'umask',
    'terminal',
    'approve',
    'delete',
    'invalidate',
  ])
})

test.each([
  ['set', `Store Sockeye credential EXAMPLE_TOKEN binding ${binding}`],
  [
    'import',
    `Import Sockeye credential EXAMPLE_TOKEN binding ${importBinding} from 1Password`,
  ],
  [
    'delete',
    `Delete Sockeye credential EXAMPLE_TOKEN binding ${deleteBinding}`,
  ],
  [
    'verify',
    `Verify Sockeye credential EXAMPLE_TOKEN binding ${verifyBinding}`,
  ],
] as const)(
  '%s identifies its binding in the authorization reason',
  (command, reason) => {
    const result = spawnSync(binary, commands[command], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, SOCKEYE_TEST_SCENARIO: 'success' },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain(`reason:${reason}`)
  },
)

test('run uses a concise Touch ID reason without exposing the manifest digest', () => {
  const result = spawnSync(binary, commands['run'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, SOCKEYE_TEST_SCENARIO: 'success' },
  })
  expect(result.status, result.stderr).toBe(23)
  expect(result.stderr).toContain(
    'reason:Allow sockeye-main-effects-test to use EXAMPLE_TOKEN, SECOND_TOKEN?',
  )
  expect(result.stderr).toMatch(/request ID: sha256:[a-f0-9]{16}\n/u)
  expect(result.stderr).toContain('arguments: [\n    "example-argument"\n  ]')
  expect(result.stderr).not.toContain('executable sha256:')
  expect(result.stderr).not.toContain('binding:')
  expect(result.stderr).not.toMatch(/reason:.*request [a-f0-9]{16}/u)
})

test.each([
  ['set', 'success', 0, 'input approve read store read invalidate policy'],
  ['set', 'input-failed', 2, 'input'],
  ['set', 'denied', 4, 'input approve'],
  ['set', 'io', 5, 'input approve read store invalidate'],
  ['delete', 'success', 0, 'terminal approve delete invalidate'],
  ['delete', 'no-terminal', 4, 'terminal'],
  ['delete', 'denied', 4, 'terminal approve'],
  ['delete', 'missing', 3, 'terminal approve delete invalidate'],
  ['delete', 'operation-denied', 4, 'terminal approve delete invalidate'],
  ['verify', 'success', 0, 'terminal approve read invalidate policy'],
  ['verify', 'no-terminal', 4, 'terminal'],
  ['verify', 'denied', 4, 'terminal approve'],
  ['verify', 'missing', 3, 'terminal approve read invalidate'],
  [
    'import',
    'success',
    0,
    'terminal approve provider read store read invalidate policy',
  ],
  ['import', 'no-terminal', 4, 'terminal'],
  ['import', 'denied', 4, 'terminal approve'],
  ['import', 'provider-failed', 5, 'terminal approve provider invalidate'],
  [
    'import',
    'unavailable',
    5,
    'terminal approve provider read store invalidate',
  ],
  ['run', 'success', 23, 'approve read read invalidate launch'],
  ['run', 'denied', 4, 'approve'],
  ['run', 'missing', 3, 'approve read invalidate'],
  ['run', 'launch-failed', 5, 'approve read read invalidate launch'],
] as const)(
  '%s %s preserves effect ordering',
  (command, scenario, status, events) => {
    const result = spawnSync(binary, commands[command], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, SOCKEYE_TEST_SCENARIO: scenario },
    })
    expect(result.status, result.stderr).toBe(status)
    expect(
      [...result.stderr.matchAll(/^effect:(\w+)$/gm)].map(match => match[1]),
    ).toEqual(events.split(' '))
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain('example-placeholder')
  },
)

test.each([
  ['set', 'invalid-name', '--binding', binding],
  ['delete', 'invalid-name', '--binding', deleteBinding],
  ['verify', 'invalid-name', '--binding', verifyBinding],
  [
    'import-1password',
    'invalid-name',
    'op://example-vault/example-item/password',
    '--binding',
    importBinding,
  ],
  [
    'import-1password',
    'EXAMPLE_TOKEN',
    'invalid-reference',
    '--binding',
    importBinding,
  ],
  ['run'],
])('invalid command %j has no effects', (...args) => {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 10_000 })
  expect(result.status).toBe(2)
  expect(result.stderr).not.toContain('effect:')
  expect(result.stdout).toBe('')
})
