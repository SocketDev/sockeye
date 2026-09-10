import { expect, test } from 'vitest'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

test('doctor diagnoses, repairs, rechecks, and preserves unknown states', () => {
  const result = spawnSync(
    getNativeTestBinaryPath('sockeye-readiness-test'),
    [],
    {
      encoding: 'utf8',
      timeout: 10_000,
    },
  )
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
})
