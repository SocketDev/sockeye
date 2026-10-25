#!/usr/bin/env node
/**
 * @file Build script for sockeye-daemon-builder. Selects the host platform's
 *   Makefile and emits the `sockeye` daemon binary under
 *   build/<mode>/<platform-arch>/out/Final/. Wraps the Makefile for pnpm
 *   integration, mirroring the other source-built daemons (libpq-builder,
 *   dawn-builder).
 */

import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { execBuildCommand } from 'local-build-infra/lib/build-operations'
import { errorMessage } from 'local-build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getSockeyeBinaryPath } from './paths.mts'
import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'

const logger = getDefaultLogger()

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// One Makefile per OS family. Windows builds the broker-only daemon (no
// biometric); macOS additionally links the Security + LocalAuthentication
// frameworks for the Keychain + Touch ID path.
const MAKEFILE_BY_PLATFORM: { __proto__: null } & Partial<
  Record<NodeJS.Platform, string>
> = {
  __proto__: null,
  darwin: 'Makefile.macos',
  linux: 'Makefile.linux',
  win32: 'Makefile.win',
}

async function main() {
  const makefile = MAKEFILE_BY_PLATFORM[process.platform]
  if (!makefile) {
    throw new Error(
      `sockeye-daemon-builder: unsupported platform '${process.platform}'. ` +
        `Supported: darwin, linux, win32.`,
    )
  }

  // common.mk picks the build dir from BUILD_MODE + PLATFORM_ARCH. Pass both
  // explicitly so the daemon binary lands where this script looks for it
  // (common.mk would otherwise default BUILD_MODE to prod under CI and drop the
  // platform-arch segment when PLATFORM_ARCH is unset).
  const platformArch = `${process.platform}-${process.arch}`
  const mode = getEnvValue('BUILD_MODE') ?? (getEnvValue('CI') ? 'prod' : 'dev')

  logger.info(`Building sockeye daemon with ${makefile} (${mode})…`)
  // execBuildCommand throws on a non-zero exit, so reaching the next line means make won.
  await execBuildCommand('make', ['-f', makefile], {
    cwd: packageRoot,
    env: { ...process.env, BUILD_MODE: mode, PLATFORM_ARCH: platformArch },
  })

  const binaryPath = getSockeyeBinaryPath(mode, platformArch)

  if (!existsSync(binaryPath)) {
    throw new Error(`Expected daemon binary not found at ${binaryPath}.`)
  }
  const stats = await stat(binaryPath)
  logger.success(`Built sockeye daemon: ${binaryPath} (${stats.size} bytes)`)
}

main().catch(e => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
