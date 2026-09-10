import { expect, test } from 'vitest'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

test('preserves canonical request bytes and ordered arguments', () => {
  const result = spawnSync(
    getNativeTestBinaryPath('sockeye-run-request-test'),
    [],
    { encoding: 'utf8', timeout: 10_000 },
  )
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe('')
})
