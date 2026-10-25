import { expect, test } from 'vitest'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

test('native stdin secret reader bounds and clears pipe input', () => {
  const result = spawnSync(
    getNativeTestBinaryPath('sockeye-stdin-secret-test'),
    [],
    { encoding: 'utf8', timeout: 10_000 },
  )
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe('')
})
