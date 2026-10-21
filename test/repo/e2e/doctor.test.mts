import { expect, test } from 'vitest'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

test.each([{ flags: [] }, { flags: ['--fix'] }])(
  'doctor $flags without a target never accesses credentials',
  ({ flags }) => {
    const result = spawnSync(
      getNativeTestBinaryPath('sockeye-doctor-test'),
      ['doctor', ...flags],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, SOCKEYE_TEST_SCENARIO: 'ready' },
      },
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toBe(
      'effects: metadata=0 approvals=0 inputs=0 writes=0',
    )
    expect(result.stdout).toContain(
      'Readiness does not establish authorization or release integrity.',
    )
  },
)
