import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './paths.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

export const NATIVE_COVERAGE_ROOTS = ['src/sockeye']
export const NATIVE_COVERAGE_TESTS = [
  'test/repo/integration/cli.test.mts',
  'test/repo/integration/portable-core.test.mts',
  'test/repo/integration/native-failures.test.mts',
  'test/repo/integration/terminal-native.test.mts',
  'test/repo/integration/stdin-secret-native.test.mts',
  'test/repo/integration/keychain-framework-native.test.mts',
  'test/repo/integration/one-password-native.test.mts',
  'test/repo/integration/run-request.test.mts',
  'test/repo/integration/readiness.test.mts',
  'test/repo/integration/explain.test.mts',
  'test/repo/integration/doctor.test.mts',
  'test/repo/integration/main-effects.test.mts',
  'test/repo/integration/native-test-build.test.mts',
]
export const NATIVE_COVERAGE_BINARIES = [
  'sockeye',
  'sockeye-input-policy-test',
  'sockeye-child-process-test',
  'sockeye-portable-core-test',
  'sockeye-file-identity-failures-test',
  'sockeye-child-process-failures-test',
  'sockeye-terminal-test',
  'sockeye-stdin-secret-test',
  'sockeye-keychain-framework-test',
  'sockeye-one-password-test',
  'sockeye-run-request-test',
  'sockeye-readiness-test',
  'sockeye-preview-isolation-test',
  'sockeye-doctor-test',
  'sockeye-main-effects-test',
]
export function validateNativeCoverageRoots(roots: string[]): void {
  if (
    roots.length !== NATIVE_COVERAGE_ROOTS.length ||
    new Set(roots).size !== roots.length ||
    NATIVE_COVERAGE_ROOTS.some(root => !roots.includes(root))
  ) {
    throw new Error(
      'Native coverage roots must include the Sockeye executable exactly once',
    )
  }
}
export function readNativeTestCounts(text: string): {
  passed: number
  failed: number
  total: number
} {
  const report: unknown = JSON.parse(text)
  if (typeof report !== 'object' || report === null) {
    throw new Error('Native Vitest receipt must be an object')
  }
  const counts = [
    'numPassedTests',
    'numFailedTests',
    'numPendingTests',
    'numTodoTests',
    'numTotalTests',
  ] as const
  for (const key of counts) {
    if (
      !(key in report) ||
      typeof Reflect.get(report, key) !== 'number' ||
      !Number.isSafeInteger(Reflect.get(report, key)) ||
      Reflect.get(report, key) < 0
    ) {
      throw new Error('Native Vitest receipt contains invalid test counts')
    }
  }
  const passed: number = Reflect.get(report, 'numPassedTests')
  const failed: number = Reflect.get(report, 'numFailedTests')
  const pending: number = Reflect.get(report, 'numPendingTests')
  const todo: number = Reflect.get(report, 'numTodoTests')
  const total: number = Reflect.get(report, 'numTotalTests')
  if (
    !('success' in report) ||
    report.success !== true ||
    failed > 0 ||
    passed === 0 ||
    pending !== 0 ||
    todo !== 0 ||
    passed + failed + pending !== total
  ) {
    throw new Error(
      'Native Vitest execution did not successfully execute tests',
    )
  }
  validateNativeSuiteReceipt(report, passed)
  return { passed, failed, total: passed + failed }
}
interface NativeSuiteReceipt {
  name: string
  status: 'passed'
  assertionResults: unknown[]
}
function isExecutedNativeSuite(suite: unknown): suite is NativeSuiteReceipt {
  return (
    typeof suite === 'object' &&
    suite !== null &&
    'name' in suite &&
    typeof suite.name === 'string' &&
    path.isAbsolute(suite.name) &&
    'status' in suite &&
    suite.status === 'passed' &&
    'assertionResults' in suite &&
    Array.isArray(suite.assertionResults) &&
    suite.assertionResults.length > 0
  )
}
function validateNativeSuiteReceipt(report: object, passed: number): void {
  if (!('testResults' in report) || !Array.isArray(report.testResults)) {
    throw new Error('Native Vitest receipt omitted suite results')
  }
  const expected = new Set(
    NATIVE_COVERAGE_TESTS.map(file =>
      normalizePath(path.resolve(REPO_ROOT, file)),
    ),
  )
  let assertions = 0
  for (const suite of report.testResults) {
    if (!isExecutedNativeSuite(suite)) {
      throw new Error('Native Vitest receipt contains an unexecuted suite')
    }
    if (!expected.delete(normalizePath(suite.name))) {
      throw new Error(
        'Native Vitest receipt contains an unexpected or duplicate suite',
      )
    }
    for (const assertion of suite.assertionResults) {
      if (
        typeof assertion !== 'object' ||
        assertion === null ||
        !('status' in assertion) ||
        assertion.status !== 'passed'
      ) {
        throw new Error('Native Vitest receipt contains an unexecuted test')
      }
      assertions += 1
    }
  }
  if (expected.size !== 0 || assertions !== passed) {
    throw new Error('Native Vitest receipt does not cover every selected test')
  }
}
export function nativeTranslationUnits(root: string): string[] {
  if (statSync(root).isFile()) {
    return [normalizePath(path.resolve(root))]
  }
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) {
      return nativeTranslationUnits(file)
    }
    return /\.(?:cc|mm)$/.test(entry.name)
      ? [normalizePath(path.resolve(file))]
      : []
  })
}
export function nativeLcovForRoot(text: string, root: string): string {
  const absolute = normalizePath(path.resolve(root))
  const records = text.split('end_of_record').filter(record => {
    const source = /^SF:(.+)$/m.exec(record)?.[1]
    if (!source) {
      return false
    }
    const file = normalizePath(path.resolve(source))
    return file === absolute || file.startsWith(absolute + '/')
  })
  const result = records
    .map(record => record.trim() + '\nend_of_record\n')
    .join('')
  const present = new Set(
    [...result.matchAll(/^SF:(.+)$/gm)].map(match =>
      normalizePath(path.resolve(match[1]!)),
    ),
  )
  for (const source of nativeTranslationUnits(root)) {
    if (!present.has(source)) {
      throw new Error(
        `Native coverage omitted production translation unit: ${source}`,
      )
    }
  }
  if (!/^DA:\d+,\d+/m.test(result)) {
    throw new Error(`Native coverage has no executable lines for ${root}`)
  }
  return result
}

export function nativeVitestArguments(receipt: string): string[] {
  return [
    'scripts/fleet/test-runner/run-vitest.mts',
    'run',
    '--config',
    '.config/repo/vitest.config.mts',
    ...NATIVE_COVERAGE_TESTS,
    '--reporter=json',
    `--outputFile=${receipt}`,
  ]
}
export function nativeVitestEnvironment(
  environment: NodeJS.ProcessEnv,
  profilePattern: string,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...environment,
    BUILD_MODE: 'coverage',
    SOCKEYE_INTERACTIVE_TESTS: '',
    LLVM_PROFILE_FILE: profilePattern,
  }
  delete result['FLEET_LANE']
  delete result['FLEET_TEST_SUMMARY_PATH']
  return result
}
