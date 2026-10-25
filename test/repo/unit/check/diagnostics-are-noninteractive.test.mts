import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { checkDiagnosticSources } from '../../../../scripts/repo/check/diagnostics-are-noninteractive.mts'
import { REPO_ROOT } from '../../../../scripts/fleet/paths.mts'

const readiness = readFileSync(path.join(REPO_ROOT, 'src/readiness.cc'), 'utf8')
const keychain = readFileSync(
  path.join(REPO_ROOT, 'src/keychain-macos.mm'),
  'utf8',
)
const cmake = readFileSync(path.join(REPO_ROOT, 'CMakeLists.txt'), 'utf8')

test('accepts the isolated diagnostic implementation', () => {
  expect(checkDiagnosticSources(readiness, keychain, cmake)).toEqual([])
})
test.each(['evaluatePolicy:', 'kSecReturnData] = @YES', 'SecItemUpdate('])(
  'rejects unsafe diagnostic bridge %s',
  forbidden => {
    expect(
      checkDiagnosticSources(
        readiness,
        keychain.replace('context.interactionNotAllowed = YES', forbidden),
        cmake,
      ).length,
    ).toBeGreaterThan(0)
  },
)
test('rejects removed UI prohibition and direct credential reads', () => {
  expect(
    checkDiagnosticSources(
      `${readiness}\nReadCredential(`,
      keychain.replaceAll('context.interactionNotAllowed = YES', ''),
      cmake,
    ).length,
  ).toBeGreaterThan(0)
})
test('rejects production test replacement linkage and absent behavior tests', () => {
  expect(
    checkDiagnosticSources(
      readiness,
      keychain,
      cmake
        .replace(
          'add_executable(sockeye',
          'add_executable(sockeye test/doctor-effects.cc',
        )
        .replaceAll('sockeye-doctor-test', 'missing-target'),
    ).length,
  ).toBeGreaterThan(0)
})
