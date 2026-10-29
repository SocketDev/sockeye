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

import { REPO_ROOT } from '../../../scripts/fleet/paths.mts'
import { checkNativeSecurityTests } from '../../../scripts/repo/check/native-security-tests-are-wired.mts'

const fixtures: string[] = []

function makeNativeWiringFixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sockeye-native-wiring-'))
  fixtures.push(root)
  for (const name of [
    'CMakeLists.txt',
    'package.json',
    'scripts/repo/preflight.mts',
    'test/repo/integration/cli.test.mts',
  ]) {
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

test('accepts instrumented security test wiring', () => {
  expect(checkNativeSecurityTests(makeNativeWiringFixture())).toEqual([])
})

test.each([
  ['CMakeLists.txt', '    sockeye-child-process-test\n', ''],
  ['CMakeLists.txt', '    sockeye-stdin-secret-test\n', ''],
  ['CMakeLists.txt', '-UNDEBUG', ''],
  [
    'CMakeLists.txt',
    'target_link_options(${target} PRIVATE -fsanitize=${SOCKEYE_SANITIZER})',
    '',
  ],
  [
    'CMakeLists.txt',
    'SOCKEYE_VERSION="${SOCKEYE_VERSION}"',
    'SOCKEYE_TESTING=1',
  ],
  ['package.json', 'check:native-security-tests', 'check:missing-security'],
  [
    'scripts/repo/preflight.mts',
    'runNativeSecurityTestsCheck()',
    'missingCheck()',
  ],
  [
    'test/repo/integration/cli.test.mts',
    'sockeye-child-process-test',
    'missing-target',
  ],
])('rejects broken wiring in %s (%s)', (name, before, after) => {
  const root = makeNativeWiringFixture()
  const target = path.join(root, name)
  const source = readFileSync(target, 'utf8')
  expect(source).toContain(before)
  writeFileSync(target, source.replace(before, after))
  expect(checkNativeSecurityTests(root).length).toBeGreaterThan(0)
})

test.each([
  { manifest: null },
  { manifest: {} },
  { manifest: { scripts: null } },
  { manifest: { scripts: { 'check:native-security-tests': 1 } } },
])('rejects malformed script registration: $manifest', ({ manifest }) => {
  const root = makeNativeWiringFixture()
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))
  expect(checkNativeSecurityTests(root)).toContain(
    'package.json: native security check is missing',
  )
})
