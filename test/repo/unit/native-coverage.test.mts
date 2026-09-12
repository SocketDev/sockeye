import { beforeEach, expect, test, vi } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import {
  NATIVE_COVERAGE_ROOTS,
  nativeLcovForRoot,
  nativeTranslationUnits,
  readNativeTestCounts,
  validateNativeCoverageRoots,
} from '../../../scripts/repo/native-coverage.mts'
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}))
beforeEach(() => vi.resetAllMocks())
const receipt = {
  success: true,
  numPassedTests: 3,
  numFailedTests: 0,
  numPendingTests: 2,
  numTotalTests: 5,
}
test('counts only executed native Vitest tests, excluding skipped tests', () => {
  expect(readNativeTestCounts(JSON.stringify(receipt))).toEqual({
    passed: 3,
    failed: 0,
    total: 3,
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
    validateNativeCoverageRoots([
      ...NATIVE_COVERAGE_ROOTS.slice(1),
      NATIVE_COVERAGE_ROOTS[1]!,
    ]),
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
