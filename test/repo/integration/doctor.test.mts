import { expect, test } from 'vitest'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

const binding = 'a'.repeat(64)

test.each([
  ['ready', [], 0, 0, 0, 0],
  ['missing', [], 5, 0, 0, 0],
  ['missing', ['--fix'], 0, 1, 1, 1],
  ['mismatch', ['--fix'], 0, 1, 1, 1],
  ['ready', ['--fix'], 0, 0, 0, 0],
  ['unknown', ['--fix'], 5, 0, 0, 0],
  ['unavailable', ['--fix'], 5, 0, 0, 0],
  ['no-terminal', ['--fix'], 5, 0, 0, 0],
  ['denied', ['--fix'], 4, 1, 1, 0],
  ['write-failed', ['--fix'], 5, 1, 1, 1],
  ['postcheck-failed', ['--fix'], 5, 1, 1, 1],
] as const)(
  'doctor %s %j preserves attended mutation boundaries',
  (scenario, flags, status, approvals, inputs, writes) => {
    const result = spawnSync(
      getNativeTestBinaryPath('sockeye-doctor-test'),
      [
        'doctor',
        '--credential',
        'EXAMPLE_TOKEN',
        '--binding',
        binding,
        ...flags,
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, SOCKEYE_TEST_SCENARIO: scenario },
      },
    )
    expect(result.status).toBe(status)
    expect(result.stderr).toContain(
      `approvals=${approvals} inputs=${inputs} writes=${writes}`,
    )
    expect(result.stdout).not.toContain('example-placeholder')
    if (status === 0 && writes === 1)
      expect(result.stderr).toContain('metadata=2')
  },
)
