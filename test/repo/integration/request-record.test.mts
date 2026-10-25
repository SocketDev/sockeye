import { expect, test } from 'vitest'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

test('stores private non-secret summaries and resolves request ID prefixes', () => {
  const result = spawnSync(
    getNativeTestBinaryPath('sockeye-request-record-test'),
    [],
    { encoding: 'utf8', timeout: 10_000 },
  )
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe('')
})
