import { expect, test } from 'vitest'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  getNativeTestBinaryPath,
  REPO_ROOT,
} from '../../../scripts/repo/paths.mts'

const binary = getNativeTestBinaryPath('sockeye-main-effects-test')
const commands: Record<string, string[]> = {
  set: ['set', 'EXAMPLE_TOKEN'],
  delete: ['delete', 'EXAMPLE_TOKEN'],
  import: [
    'import-1password',
    'EXAMPLE_TOKEN',
    'op://example-vault/example-item/password',
  ],
  run: [
    'run',
    '--credential',
    'EXAMPLE_TOKEN',
    '--credential',
    'SECOND_TOKEN',
    '--cwd',
    REPO_ROOT,
    '--',
    binary,
    'example-argument',
  ],
}

test.each([
  ['set', 'success', 0, 'input approve store invalidate'],
  ['set', 'input-failed', 2, 'input'],
  ['set', 'denied', 4, 'input approve'],
  ['set', 'io', 5, 'input approve store invalidate'],
  ['delete', 'success', 0, 'terminal approve delete invalidate'],
  ['delete', 'no-terminal', 4, 'terminal'],
  ['delete', 'denied', 4, 'terminal approve'],
  ['delete', 'missing', 3, 'terminal approve delete invalidate'],
  ['delete', 'operation-denied', 4, 'terminal approve delete invalidate'],
  ['import', 'success', 0, 'terminal approve provider store invalidate'],
  ['import', 'no-terminal', 4, 'terminal'],
  ['import', 'denied', 4, 'terminal approve'],
  ['import', 'provider-failed', 5, 'terminal approve provider invalidate'],
  ['import', 'unavailable', 5, 'terminal approve provider store invalidate'],
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
  ['set', 'invalid-name'],
  ['delete', 'invalid-name'],
  [
    'import-1password',
    'invalid-name',
    'op://example-vault/example-item/password',
  ],
  ['import-1password', 'EXAMPLE_TOKEN', 'invalid-reference'],
  ['run'],
])('invalid command %j has no effects', (...args) => {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 10_000 })
  expect(result.status).toBe(2)
  expect(result.stderr).not.toContain('effect:')
  expect(result.stdout).toBe('')
})
