#!/usr/bin/env node
/**
 * @file Configure and build the host Sockeye executable with CMake.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../fleet/paths.mts'
import { getBinaryPath, getCmakeBuildDir, getOutputDir } from './paths.mts'

const logger = getDefaultLogger()

async function run(command: string, args: string[]): Promise<void> {
  const result = await spawn(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  if (result.code !== 0) {
    throw new Error(`${command} failed with exit code ${result.code}`)
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Sockeye build refused on ${process.platform}; the current release contract requires macOS Touch ID`,
    )
  }
  const mode = process.env['BUILD_MODE'] ?? (process.env['CI'] ? 'prod' : 'dev')
  const sanitizer =
    mode === 'asan' ? 'address' : mode === 'ubsan' ? 'undefined' : 'none'
  const platformArch = `${process.platform}-${process.arch}`
  const cmakeBuildDir = getCmakeBuildDir(mode, platformArch)
  const outputDir = getOutputDir(mode, platformArch)
  const packageJson: { version: string } = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  )
  const version = process.env['RELEASE_VERSION'] ?? packageJson.version
  const buildType = mode === 'prod' ? 'Release' : 'Debug'
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64'

  mkdirSync(cmakeBuildDir, { recursive: true })
  mkdirSync(outputDir, { recursive: true })
  logger.info(`Building Sockeye ${version} (${mode}, ${platformArch})…`)
  await run('cmake', [
    '-S',
    REPO_ROOT,
    '-B',
    cmakeBuildDir,
    `-DCMAKE_BUILD_TYPE=${buildType}`,
    `-DCMAKE_OSX_ARCHITECTURES=${architecture}`,
    `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${outputDir}`,
    `-DSOCKEYE_VERSION=${version}`,
    `-DSOCKEYE_SANITIZER=${sanitizer}`,
  ])
  await run('cmake', ['--build', cmakeBuildDir, '--parallel'])

  const binaryPath = getBinaryPath(mode, platformArch)
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Sockeye build completed without the expected binary at ${binaryPath}`,
    )
  }
  const metadata = await stat(binaryPath)
  logger.success(`Built ${binaryPath} (${metadata.size} bytes)`)
}

main().catch((error: unknown) => {
  logger.fail(`Sockeye build failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
