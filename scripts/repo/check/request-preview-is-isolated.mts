import { readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/main/run.mts'
import type { ScriptMeta } from '../../fleet/process/main/run.mts'

const logger = getDefaultLogger()

function checkPreviewTargets(cmake: string, issues: string[]): void {
  const product =
    cmake.match(/add_executable\(sockeye\s+(?<body>[^)]*)\)/u)?.groups?.[
      'body'
    ] ?? ''
  if (
    !product.includes('src/sockeye/run-request.cc') ||
    product.includes('test/')
  ) {
    issues.push(
      'production must use request preparation without test dependencies',
    )
  }
  const testTarget =
    cmake.match(
      /add_executable\(sockeye-preview-isolation-test\s+(?<body>[^)]*)\)/u,
    )?.groups?.['body'] ?? ''
  if (
    !testTarget.includes('test/repo/integration/native/forbidden-effects.cc') ||
    testTarget.includes('src/sockeye/keychain-macos.mm') ||
    testTarget.includes('src/sockeye/child-process.cc')
  ) {
    issues.push(
      'preview isolation target must use forbidden-effect dependencies',
    )
  }
}

export function checkRequestPreview(repoRoot: string): string[] {
  const request = readFileSync(
    path.join(repoRoot, 'src/sockeye/run-request.cc'),
    'utf8',
  )
  const main = readFileSync(path.join(repoRoot, 'src/sockeye/main.cc'), 'utf8')
  const cmake = readFileSync(path.join(repoRoot, 'CMakeLists.txt'), 'utf8')
  const issues: string[] = []
  if (
    /InspectBiometricReadiness|InspectCredentialPolicy|AuthorizationContext|ReadCredential|StoreCredential|DeleteCredential|LaunchChild|getenv|posix_spawn/u.test(
      request,
    )
  ) {
    issues.push('request preparation contains a forbidden effect')
  }
  if (
    (main.match(/PrepareRunRequest\(argc, argv, options,/gu) ?? []).length !==
      2 ||
    (main.match(/CanonicalRunManifest\(options\)/gu) ?? []).length !== 2
  ) {
    issues.push('run and explain must share preparation and canonical encoding')
  }
  checkPreviewTargets(cmake, issues)
  return issues
}

export function runRequestPreviewCheck(): number {
  const issues = checkRequestPreview(REPO_ROOT)
  for (const issue of issues) {
    logger.fail(
      `Preview isolation failed: ${issue}. Expected shared, effect-free preparation. Repair the request boundary.`,
    )
  }
  return issues.length ? 1 : 0
}

const SCRIPT_META: ScriptMeta = {
  describe: 'Validate shared request preparation and isolated preview tests.',
  help: 'Usage: pnpm run check:request-preview',
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(runRequestPreviewCheck, SCRIPT_META)
}
