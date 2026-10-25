import { readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/main/run.mts'
import type { ScriptMeta } from '../../fleet/process/main/run.mts'

const logger = getDefaultLogger()

function nativeSecurityScript(manifest: unknown): string {
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('scripts' in manifest)
  ) {
    return ''
  }
  const { scripts } = manifest
  if (
    typeof scripts !== 'object' ||
    scripts === null ||
    !('check:native-security-tests' in scripts)
  ) {
    return ''
  }
  const command = scripts['check:native-security-tests']
  return typeof command === 'string' ? command : ''
}

export function checkNativeSecurityTests(repoRoot: string): string[] {
  const issues: string[] = []
  const cmake = readFileSync(path.join(repoRoot, 'CMakeLists.txt'), 'utf8')
  const targets =
    cmake.match(/list\(APPEND SOCKEYE_SECURITY_TARGETS\s+(?<body>[^)]*)\)/u)
      ?.groups?.['body'] ?? ''
  for (const target of [
    'sockeye-child-process-test',
    'sockeye-input-policy-test',
    'sockeye-stdin-secret-test',
  ]) {
    if (!targets.split(/\s+/u).includes(target)) {
      issues.push(`${target}: missing sanitizer coverage`)
    }
  }
  for (const contract of [
    'target_compile_options(${target} PRIVATE -UNDEBUG)',
    'target_compile_options(${target} PRIVATE -fsanitize=${SOCKEYE_SANITIZER}',
    'target_link_options(${target} PRIVATE -fsanitize=${SOCKEYE_SANITIZER})',
  ]) {
    if (!cmake.includes(contract)) {
      issues.push(`CMakeLists.txt: missing ${contract}`)
    }
  }
  if (
    /target_compile_definitions\(sockeye\s+[^)]*SOCKEYE_TESTING/u.test(cmake) ||
    /add_compile_definitions\([^)]*SOCKEYE_TESTING/u.test(cmake)
  ) {
    issues.push('sockeye: production exposes testing hooks')
  }
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  )
  if (
    !nativeSecurityScript(manifest).includes(
      'native-security-tests-are-wired.mts',
    )
  ) {
    issues.push('package.json: native security check is missing')
  }
  const preflight = readFileSync(
    path.join(repoRoot, 'scripts/repo/preflight.mts'),
    'utf8',
  )
  if (!preflight.includes('runNativeSecurityTestsCheck()')) {
    issues.push('preflight: native security check is missing')
  }
  const integration = readFileSync(
    path.join(repoRoot, 'test/repo/integration/cli.test.mts'),
    'utf8',
  )
  if (
    !integration.includes(
      "getNativeTestBinaryPath('sockeye-child-process-test')",
    )
  ) {
    issues.push('Vitest: child process target is missing')
  }
  return issues
}

export function runNativeSecurityTestsCheck(): number {
  const issues = checkNativeSecurityTests(REPO_ROOT)
  for (const issue of issues) {
    logger.fail(
      `Native security wiring failed at ${issue}. Expected instrumented, isolated tests. Repair the named contract.`,
    )
  }
  return issues.length ? 1 : 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'Check native security instrumentation, production isolation, and test wiring.',
  help: 'Usage: pnpm run check:native-security-tests',
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(runNativeSecurityTestsCheck, SCRIPT_META)
}
