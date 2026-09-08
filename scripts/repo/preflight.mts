import process from 'node:process'

import { main as runFleetPreflight } from '../fleet/preflight.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import { runBuildRequirementsCheck } from './check/build-requirements-are-valid.mts'

export function combinePreflightResults(config: {
  fleetStatus: number
  requirementStatus: number
}): number {
  const { fleetStatus, requirementStatus } = {
    __proto__: null,
    ...config,
  } as typeof config
  return fleetStatus || requirementStatus
}

async function main(): Promise<number> {
  const requirementStatus = runBuildRequirementsCheck()
  const fleetStatus = await runFleetPreflight(process.argv.slice(2))
  return combinePreflightResults({ fleetStatus, requirementStatus })
}

const SCRIPT_META: ScriptMeta = {
  describe: 'Run fleet preflight and validate repository build requirements.',
  help: 'Usage: pnpm run preflight [--tests|--full]',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
