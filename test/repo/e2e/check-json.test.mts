import process from 'node:process'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, test } from 'vitest'

test.each([
  'diagnostics-are-noninteractive',
  'keychain-evidence-is-complete',
  'native-security-tests-are-wired',
  'request-preview-is-isolated',
])('%s returns one JSON result', checkName => {
  const result = spawnSync(
    process.execPath,
    [`scripts/repo/check/${checkName}.mts`, '--json'],
    { encoding: 'utf8', timeout: 10_000 },
  )
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ ok: true, exitCode: 0 })
})
