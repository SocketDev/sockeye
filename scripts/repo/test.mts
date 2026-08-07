#!/usr/bin/env node
/**
 * @file Build the native executable, then run the repo's Vitest suite through
 *   the fleet runner. Vitest remains the only test orchestrator; it launches
 *   the compiled C++ program for integration assertions.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/_shared/is-main-module.mts'
import { REPO_ROOT } from '../fleet/paths.mts'

const logger = getDefaultLogger()

async function run(script: string, args: string[] = []): Promise<number> {
  const result = await spawn(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  return result.code ?? 1
}

async function main(): Promise<void> {
  const buildStatus = await run('scripts/repo/build.mts')
  if (buildStatus !== 0) {
    process.exitCode = buildStatus
    return
  }
  const requestedTests = process.argv.slice(2)
  const testStatus = await run(
    'scripts/fleet/test.mts',
    requestedTests.length > 0 ? requestedTests : ['test/repo'],
  )
  if (testStatus !== 0) {
    logger.fail(`Vitest failed with exit code ${testStatus}`)
    process.exitCode = testStatus
  }
}

if (isMainModule(import.meta.url)) {
  void main()
}
