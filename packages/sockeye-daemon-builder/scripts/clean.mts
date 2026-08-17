/**
 * @file Clean sockeye-daemon-builder build artifacts.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { cleanBuilder } from 'local-build-infra/lib/clean-builder'
import { errorMessage } from 'local-build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const logger = getDefaultLogger()

cleanBuilder('sockeye-daemon-builder', {
  checkpointModes: [],
  cleanDirs: ['build', 'out'],
  packageDir,
}).catch(error => {
  logger.fail(`Clean failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
