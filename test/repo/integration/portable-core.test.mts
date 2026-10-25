import { expect, test } from 'vitest'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

test('production native core preserves buffers, file identity and child context', () => {
  const result = spawnSync(
    getNativeTestBinaryPath('sockeye-portable-core-test'),
    [],
    { encoding: 'utf8', timeout: 10_000 },
  )
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe('')
})
