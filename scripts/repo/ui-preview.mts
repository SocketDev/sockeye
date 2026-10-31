#!/usr/bin/env node
import { existsSync } from 'node:fs'
import process from 'node:process'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/main/run.mts'
import type { ScriptMeta } from '../fleet/process/main/run.mts'
import { scriptStdio } from '../fleet/process/script-output.mts'
import { getBinaryPath, REPO_ROOT } from './paths.mts'

export const SCRIPT_META: ScriptMeta = {
  describe: 'Open the non-authenticating approval panel preview.',
  help: 'Usage: pnpm run ui-preview\nBuild the dev executable first with pnpm run build --dev.',
  json: 'result',
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('The Sockeye approval preview requires macOS.')
  }
  const binary = getBinaryPath('dev', `${process.platform}-${process.arch}`)
  if (!existsSync(binary)) {
    throw new Error(
      'Sockeye preview binary is missing. Run pnpm run build --dev.',
    )
  }
  const result = await spawn(binary, ['ui-preview'], {
    cwd: REPO_ROOT,
    stdio: scriptStdio('inherit'),
  })
  if (result.code !== 0) {
    process.exitCode = result.code ?? 1
  }
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
