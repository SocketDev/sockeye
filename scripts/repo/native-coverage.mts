import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

export const NATIVE_COVERAGE_ROOTS = [
  'src/sockeye',
  'packages/keychain-addon-builder/src',
  'packages/keystore-infra/src/socketsecurity/keystore-infra/keystore_macos.mm',
]
export const NATIVE_COVERAGE_TESTS = [
  'test/repo/integration/cli.test.mts',
  'test/repo/integration/portable-core.test.mts',
  'test/repo/integration/run-request.test.mts',
  'test/repo/integration/readiness.test.mts',
  'test/repo/integration/explain.test.mts',
  'test/repo/integration/doctor.test.mts',
  'test/repo/integration/native-test-build.test.mts',
]
export const NATIVE_COVERAGE_BINARIES = [
  'sockeye',
  'sockeye-input-policy-test',
  'sockeye-child-process-test',
  'sockeye-portable-core-test',
  'sockeye-run-request-test',
  'sockeye-readiness-test',
  'sockeye-preview-isolation-test',
  'sockeye-doctor-test',
]
export function validateNativeCoverageRoots(roots: string[]): void {
  if (
    roots.length !== NATIVE_COVERAGE_ROOTS.length ||
    new Set(roots).size !== roots.length ||
    NATIVE_COVERAGE_ROOTS.some(root => !roots.includes(root))
  ) {
    throw new Error(
      'Native coverage roots must include the CLI, addon shim, and macOS keystore backend exactly once',
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
  const total: number = Reflect.get(report, 'numTotalTests')
  if (
    !('success' in report) ||
    report.success !== true ||
    failed > 0 ||
    passed === 0 ||
    passed + failed + pending !== total
  ) {
    throw new Error(
      'Native Vitest execution did not successfully execute tests',
    )
  }
  return { passed, failed, total: passed + failed }
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
