import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'
import type { ScriptMeta } from '../../fleet/process/run-main.mts'

const logger = getDefaultLogger()

export function checkDiagnosticSources(
  readiness: string,
  keychain: string,
  cmake: string,
): string[] {
  const issues: string[] = []
  const inspection =
    keychain
      .split('KeychainStatus InspectBiometricReadiness(')[1]
      ?.split('struct AuthorizationContext::Impl')[0] ?? ''
  // Reject approval, secret-return queries, and Keychain mutation calls.
  if (
    !inspection ||
    /evaluatePolicy:|kSecReturnData\]\s*=\s*@YES|SecItemAdd\(|SecItemUpdate\(|SecItemDelete\(/u.test(
      inspection,
    )
  ) {
    issues.push(
      'metadata/capability bridge must not authenticate, return secret data, or mutate items',
    )
  }
  for (const requirement of [
    'context.interactionNotAllowed = YES',
    'kSecReturnData] = @NO',
    'kSecReturnAttributes] = @YES',
    'kSecUseAuthenticationContext] = context',
  ]) {
    if (!inspection.includes(requirement)) {
      issues.push(`metadata bridge requires ${requirement}`)
    }
  }
  if (
    /Authenticate\(|ReadCredential\(|StoreCredential\(|LaunchChild\(|ReadSecretFromTerminal\(/u.test(
      readiness,
    )
  ) {
    issues.push(
      'readiness must use the attended repair callback and capability-only probes',
    )
  }
  const production =
    cmake.match(/add_executable\(sockeye\s+(?<sources>[^)]*)\)/u)?.groups?.[
      'sources'
    ] ?? ''
  if (
    !production ||
    /test\/|doctor-effects|forbidden-effects/u.test(production)
  ) {
    issues.push('production target must not link diagnostic test replacements')
  }
  if (
    !cmake.includes('sockeye-doctor-test') ||
    !cmake.includes('sockeye-readiness-test')
  ) {
    issues.push('diagnostic behavior targets are missing')
  }
  return issues
}

export function runDiagnosticsCheck(): number {
  const issues = checkDiagnosticSources(
    readFileSync(path.join(REPO_ROOT, 'src/sockeye/readiness.cc'), 'utf8'),
    readFileSync(path.join(REPO_ROOT, 'src/sockeye/keychain-macos.mm'), 'utf8'),
    readFileSync(path.join(REPO_ROOT, 'CMakeLists.txt'), 'utf8'),
  )
  for (const issue of issues) {
    logger.fail(
      `Diagnostic isolation failed: ${issue}. Repair the named boundary and rerun doctor tests.`,
    )
  }
  return issues.length ? 1 : 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'Check doctor capability queries and production isolation alongside behavioral tests.',
  help: 'Usage: pnpm run check:diagnostics',
}

if (isMainModule(import.meta.url)) {
  runMain(runDiagnosticsCheck, SCRIPT_META)
}
