import process from 'node:process'

import { main as runFleetPreflight } from '../fleet/preflight.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import { runDiagnosticsCheck } from './check/diagnostics-are-noninteractive.mts'
import { runRequestPreviewCheck } from './check/request-preview-is-isolated.mts'
import { runNativeSecurityTestsCheck } from './check/native-security-tests-are-wired.mts'
import { runKeychainEvidenceCheck } from './check/keychain-evidence-is-complete.mts'
import { runBuildRequirementsCheck } from './check/build-requirements-are-valid.mts'

export function combinePreflightResults(config: {
  fleetStatus: number
  requirementStatus: number
  diagnosticsStatus: number
  previewStatus: number
  nativeSecurityStatus: number
  keychainEvidenceStatus: number
}): number {
  const {
    fleetStatus,
    requirementStatus,
    nativeSecurityStatus,
    keychainEvidenceStatus,
    previewStatus,
    diagnosticsStatus,
  } = {
    __proto__: null,
    ...config,
  } as typeof config
  return (
    fleetStatus ||
    requirementStatus ||
    nativeSecurityStatus ||
    keychainEvidenceStatus ||
    previewStatus ||
    diagnosticsStatus
  )
}

async function main(): Promise<number> {
  const diagnosticsStatus = runDiagnosticsCheck()
  const previewStatus = runRequestPreviewCheck()
  const nativeSecurityStatus = runNativeSecurityTestsCheck()
  const keychainEvidenceStatus = runKeychainEvidenceCheck({ args: [] })
  const requirementStatus = runBuildRequirementsCheck()
  const fleetStatus = await runFleetPreflight(process.argv.slice(2))
  return combinePreflightResults({
    fleetStatus,
    requirementStatus,
    nativeSecurityStatus,
    keychainEvidenceStatus,
    previewStatus,
    diagnosticsStatus,
  })
}

const SCRIPT_META: ScriptMeta = {
  describe: 'Run fleet preflight and validate repository build requirements.',
  help: 'Usage: pnpm run preflight [--tests|--full]',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
