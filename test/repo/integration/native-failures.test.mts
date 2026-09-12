import { expect, test } from 'vitest'
import path from 'node:path'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  getBuildMode,
  getCmakeBuildDir,
  getNativeTestBinaryPath,
} from '../../../scripts/repo/paths.mts'

test.each([
  ['sockeye-file-identity-failures-test', 'file-identity'],
  ['sockeye-child-process-failures-test', 'child-process'],
])('%s cleans up each failed boundary', (name, source) => {
  const binary = getNativeTestBinaryPath(name)
  const imports = spawnSync('xcrun', ['nm', '-u', binary], { encoding: 'utf8' })
  expect(imports.status).toBe(0)
  expect(imports.stdout).not.toMatch(/_(?:posix_spawn\w*|waitpid)\b/u)
  const object = path.join(
    getCmakeBuildDir(getBuildMode(), `${process.platform}-${process.arch}`),
    'CMakeFiles',
    `${name}.dir`,
    'src',
    'sockeye',
    `${source}.cc.o`,
  )
  const sourceImports = spawnSync('xcrun', ['nm', '-u', object], {
    encoding: 'utf8',
  })
  expect(sourceImports.status).toBe(0)
  expect(sourceImports.stdout).not.toMatch(
    /_(?:posix_spawn\w*|waitpid|open|close|pipe|read|write|fstat|realpath)\b/u,
  )
  const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe('')
})
