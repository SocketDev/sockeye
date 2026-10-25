import { expect, test } from 'vitest'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

test('native provider rejects failed reads and uncollected child status', () => {
  const binary = getNativeTestBinaryPath('sockeye-one-password-test')
  const imports = spawnSync('xcrun', ['nm', '-u', binary], { encoding: 'utf8' })
  expect(imports.status).toBe(0)
  expect(imports.stdout).not.toMatch(/\b_posix_spawn(?:\$[^\s]+)?$/mu)
  const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe('')
})
