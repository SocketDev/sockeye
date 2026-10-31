import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { checkRequestPreview } from '../../../../scripts/repo/check/request-preview-is-isolated.mts'
import { REPO_ROOT } from '../../../../scripts/fleet/paths.mts'

const fixtures: string[] = []

function makePreviewFixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sockeye-preview-check-'))
  fixtures.push(root)
  for (const name of ['CMakeLists.txt', 'src/main.cc', 'src/run-request.cc']) {
    const target = path.join(root, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(path.join(REPO_ROOT, name)))
  }
  return root
}

afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true })
})

test('accepts shared isolated request preparation', () => {
  expect(checkRequestPreview(makePreviewFixture())).toEqual([])
})

test.each([
  [
    'src/run-request.cc',
    'namespace sockeye',
    'void InspectBiometricReadiness();\nnamespace sockeye',
  ],
  [
    'src/run-request.cc',
    'namespace sockeye',
    'void InspectCredentialPolicy();\nnamespace sockeye',
  ],
  [
    'src/run-request.cc',
    'namespace sockeye',
    'void ReadCredential();\nnamespace sockeye',
  ],
  [
    'src/main.cc',
    'PrepareRunRequest(argc, argv, options,',
    'OtherParser(argc, argv, options,',
  ],
  ['CMakeLists.txt', '  src/run-request.cc', '  test/forbidden-effects.cc'],
  [
    'CMakeLists.txt',
    'test/repo/integration/native/forbidden-effects.cc',
    'src/keychain-macos.mm',
  ],
])('rejects preview isolation drift in %s', (name, before, after) => {
  const root = makePreviewFixture()
  const target = path.join(root, name)
  const source = readFileSync(target, 'utf8')
  expect(source).toContain(before)
  writeFileSync(target, source.replace(before, after))
  expect(checkRequestPreview(root).length).toBeGreaterThan(0)
})
