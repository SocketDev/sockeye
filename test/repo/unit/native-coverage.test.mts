import { beforeEach, expect, test, vi } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../../../scripts/repo/paths.mts'
import {
  NATIVE_COVERAGE_ROOTS,
  NATIVE_COVERAGE_TESTS,
  nativeLcovForRoot,
  nativeTranslationUnits,
  nativeVitestArguments,
  nativeVitestEnvironment,
  readNativeTestCounts,
  validateNativeCoverageRoots,
} from '../../../scripts/repo/native-coverage.mts'
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
}))
beforeEach(() => vi.resetAllMocks())
const receipt = {
  success: true,
  numPassedTests: NATIVE_COVERAGE_TESTS.length,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numTotalTests: NATIVE_COVERAGE_TESTS.length,
  testResults: NATIVE_COVERAGE_TESTS.map(file => ({
    name: path.resolve(REPO_ROOT, file),
    status: 'passed',
    assertionResults: [{ status: 'passed' }],
  })),
}
test('counts every selected native suite with fully executed tests', () => {
  expect(readNativeTestCounts(JSON.stringify(receipt))).toEqual({
    passed: NATIVE_COVERAGE_TESTS.length,
    failed: 0,
    total: NATIVE_COVERAGE_TESTS.length,
  })
})
test.each([
  '',
  '{invalid',
  'null',
  '[]',
  '{}',
  JSON.stringify({ ...receipt, success: false }),
  JSON.stringify({ ...receipt, numPassedTests: 0, numTotalTests: 2 }),
  JSON.stringify({ ...receipt, numFailedTests: 1, numTotalTests: 6 }),
  JSON.stringify({ ...receipt, numTotalTests: 99 }),
  JSON.stringify({ ...receipt, numPendingTests: -1 }),
  JSON.stringify({ ...receipt, numPassedTests: '3' }),
  JSON.stringify({ ...receipt, numPassedTests: 1.5 }),
])('rejects absent, malformed, empty or failed receipt %s', content => {
  expect(() => readNativeTestCounts(content)).toThrow()
})
test('requires all production native roots without duplicate entries', () => {
  expect(() =>
    validateNativeCoverageRoots([...NATIVE_COVERAGE_ROOTS].reverse()),
  ).not.toThrow()
  expect(() =>
    validateNativeCoverageRoots(NATIVE_COVERAGE_ROOTS.slice(1)),
  ).toThrow()
  expect(() =>
    validateNativeCoverageRoots([...NATIVE_COVERAGE_ROOTS, 'src']),
  ).toThrow()
})
test('preserves uncovered production records and omits unrelated test/library records', () => {
  vi.mocked(statSync).mockReturnValue({ isFile: () => true } as ReturnType<
    typeof statSync
  >)
  const lcov =
    'SF:/example/main.cc\nDA:1,0\nend_of_record\nSF:/example/test.cc\nDA:1,1\nend_of_record\n'
  expect(nativeLcovForRoot(lcov, '/example/main.cc')).toBe(
    'SF:/example/main.cc\nDA:1,0\nend_of_record\n',
  )
})
test('fails when a production translation unit is absent from LLVM output', () => {
  vi.mocked(statSync).mockReturnValue({ isFile: () => true } as ReturnType<
    typeof statSync
  >)
  expect(() =>
    nativeLcovForRoot(
      'SF:/example/test.cc\nDA:1,1\nend_of_record\n',
      '/example/main.cc',
    ),
  ).toThrow()
})
test('fails when an included translation unit has no measured line inventory', () => {
  vi.mocked(statSync).mockReturnValue({ isFile: () => true } as ReturnType<
    typeof statSync
  >)
  expect(() =>
    nativeLcovForRoot(
      'SF:/example/main.cc\nend_of_record\n',
      '/example/main.cc',
    ),
  ).toThrow()
})
test('discovers C++ and Objective-C++ production units recursively', () => {
  vi.mocked(statSync).mockReturnValue({ isFile: () => false } as ReturnType<
    typeof statSync
  >)
  vi.mocked(readdirSync)
    .mockReturnValueOnce([
      { name: 'main.cc', isDirectory: () => false },
      { name: 'keychain.mm', isDirectory: () => false },
      { name: 'header.h', isDirectory: () => false },
      { name: 'nested', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)
    .mockReturnValueOnce([
      { name: 'policy.cc', isDirectory: () => false },
    ] as unknown as ReturnType<typeof readdirSync>)
  expect(nativeTranslationUnits('/example')).toEqual([
    '/example/main.cc',
    '/example/keychain.mm',
    '/example/nested/policy.cc',
  ])
})

test.each([
  'omitted',
  'duplicate',
  'unknown',
  'pending',
  'todo',
  'empty',
  'failed-assertion',
])('rejects incomplete native receipt %s', defect => {
  const candidate = structuredClone(receipt)
  if (defect === 'omitted') candidate.testResults.pop()
  else if (defect === 'duplicate')
    candidate.testResults[1] = candidate.testResults[0]!
  else if (defect === 'unknown')
    candidate.testResults[0]!.name = '/example/unrelated.test.mts'
  else if (defect === 'pending') candidate.numPendingTests = 1
  else if (defect === 'todo') candidate.numTodoTests = 1
  else if (defect === 'empty') candidate.testResults[0]!.assertionResults = []
  else candidate.testResults[0]!.assertionResults[0]!.status = 'pending'
  expect(() => readNativeTestCounts(JSON.stringify(candidate))).toThrow()
})

test('composes the canonical Vitest child runner inside the native coverage phase', () => {
  const args = nativeVitestArguments('/example/native-receipt.json')
  expect(args.slice(0, 4)).toEqual([
    'scripts/fleet/test-runner/run-vitest.mts',
    'run',
    '--config',
    '.config/repo/vitest.config.mts',
  ])
  expect(args.slice(4, -2)).toEqual(NATIVE_COVERAGE_TESTS)
  expect(args.slice(-2)).toEqual([
    '--reporter=json',
    '--outputFile=/example/native-receipt.json',
  ])
  expect(args).not.toContain('--force-during-active-run')
})
test('native child coverage does not inherit the JavaScript tier or overwrite parent test counts', () => {
  const parent = {
    FLEET_LANE: 'slow',
    FLEET_TEST_SUMMARY_PATH: '/example/parent.json',
    EXAMPLE_CONFIG: 'preserved',
  }
  const environment = nativeVitestEnvironment(parent, '/example/%m-%p.profraw')
  expect(environment).toEqual({
    EXAMPLE_CONFIG: 'preserved',
    BUILD_MODE: 'coverage',
    SOCKEYE_INTERACTIVE_TESTS: '',
    LLVM_PROFILE_FILE: '/example/%m-%p.profraw',
  })
  expect(parent.FLEET_LANE).toBe('slow')
})
