import { expect, test } from 'vitest'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getNativeTestBinaryPath } from '../../../scripts/repo/paths.mts'

test.each([
  'sockeye-keychain-framework-test',
  'sockeye-keystore-framework-test',
])('framework doubles isolate real credential APIs in %s', name => {
  const binary = getNativeTestBinaryPath(name)
  const imports = spawnSync('xcrun', ['nm', '-u', binary], { encoding: 'utf8' })
  expect(imports.status).toBe(0)
  expect(imports.stdout).not.toMatch(
    /_(?:SecItem\w+|SecAccessControl\w+|OBJC_CLASS_\$_LAContext)\b/u,
  )
  const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe('')
})
