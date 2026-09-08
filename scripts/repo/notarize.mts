#!/usr/bin/env node
/**
 * @file Notarize signed Sockeye release archives and staple the ticket
 *   (release-checklist step 5). Dry-run is the default and prints the exact
 *   notarytool + stapler invocations with their preconditions; `--run`
 *   executes them. Credentials never touch this script: notarytool reads the
 *   keychain profile created once by
 *   `xcrun notarytool store-credentials <profile>`.
 *   Stapling truth: `stapler staple` works on .app bundles, .dmg, and .pkg.
 *   A .zip archive — and the bare Mach-O inside it — cannot hold a stapled
 *   ticket; Gatekeeper fetches the ticket for the binary's signature online.
 *   This script staples what can be stapled and says so when it cannot.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from 'node:util'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import { displayCommand } from './sign.mts'

const logger = getDefaultLogger()

export const NOTARY_PROFILE_ENV = 'SOCKEYE_NOTARY_PROFILE'

const SUBMITTABLE_EXTENSIONS = new Set(['.dmg', '.pkg', '.zip'])
const STAPLEABLE_EXTENSIONS = new Set(['.dmg', '.pkg'])

export function isStapleable(archive: string): boolean {
  return STAPLEABLE_EXTENSIONS.has(path.extname(archive).toLowerCase())
}

async function runXcrun(args: string[]): Promise<void> {
  const result = await spawn('/usr/bin/xcrun', args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  if (result.code !== 0) {
    throw new Error(`xcrun ${args[0]} failed with exit code ${result.code}`)
  }
}

function validateNotaryArchives(archives: string[]): void {
  for (let i = 0, { length } = archives; i < length; i += 1) {
    const archive = archives[i]!
    const extension = path.extname(archive).toLowerCase()
    if (!SUBMITTABLE_EXTENSIONS.has(extension)) {
      throw new Error(
        `notarytool only accepts .zip, .dmg, or .pkg; got ${archive}`,
      )
    }
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Sockeye notarization refused on ${process.platform}; notarytool requires macOS`,
    )
  }
  const { positionals, values } = parseArgs({
    options: {
      help: { default: false, type: 'boolean' },
      'keychain-profile': { type: 'string' },
      run: { default: false, type: 'boolean' },
    },
    allowPositionals: true,
    strict: false,
  })
  if (values['help'] || positionals.length === 0) {
    logger.log('Usage: pnpm run notarize -- [options] <archive…>')
    logger.log('')
    logger.log('  default                    dry run: print the exact calls')
    logger.log('  --run                      submit, wait, and staple')
    logger.log('  --keychain-profile <name>  notarytool keychain profile')
    logger.log(`                             (default: $${NOTARY_PROFILE_ENV})`)
    logger.log('')
    logger.log('  archives must be .zip, .dmg, or .pkg — the exact files that')
    logger.log('  will be uploaded to the release')
    if (!values['help']) {
      process.exitCode = 1
    }
    return
  }

  const configuredProfile =
    typeof values['keychain-profile'] === 'string'
      ? values['keychain-profile']
      : process.env[NOTARY_PROFILE_ENV]
  const execute = values['run'] === true
  const profile = configuredProfile ?? `$${NOTARY_PROFILE_ENV}`
  const archives = positionals.map(String)

  validateNotaryArchives(archives)

  if (!execute) {
    logger.info('Dry run — nothing is submitted. Exact invocations:')
    for (let i = 0, { length } = archives; i < length; i += 1) {
      const archive = archives[i]!
      logger.log(
        `  ${displayCommand('/usr/bin/xcrun', ['notarytool', 'submit', archive, '--keychain-profile', profile, '--wait'])}`,
      )
      if (isStapleable(archive)) {
        logger.log(
          `  ${displayCommand('/usr/bin/xcrun', ['stapler', 'staple', archive])}`,
        )
      } else {
        logger.log(
          `  (no staple: ${path.basename(archive)} is a zip — the ticket attaches to the binary's signature online, not to the archive)`,
        )
      }
    }
    logger.log('')
    logger.log('Preconditions:')
    logger.log(
      `  - run "xcrun notarytool store-credentials ${profile}" once so the profile exists in the login keychain`,
    )
    logger.log('  - each archive is already signed (pnpm run sign --run)')
    logger.log(
      '  - submission uploads to Apple, so the run needs network access',
    )
    logger.log('Run with --run to submit and wait.')
    return
  }

  if (configuredProfile === undefined) {
    throw new Error(
      `No keychain profile: pass --keychain-profile or set ${NOTARY_PROFILE_ENV} to the profile created by "xcrun notarytool store-credentials"`,
    )
  }
  for (let i = 0, { length } = archives; i < length; i += 1) {
    const archive = archives[i]!
    if (!existsSync(archive)) {
      throw new Error(`Nothing to notarize at ${archive}`)
    }
    logger.info(`Submitting ${archive} for notarization (waits for Apple)…`)
    await runXcrun([
      'notarytool',
      'submit',
      archive,
      '--keychain-profile',
      configuredProfile,
      '--wait',
    ])
    logger.log(
      'Confirm the log above shows "status: Accepted"; fetch details with "xcrun notarytool log <submission-id>"',
    )
    if (isStapleable(archive)) {
      await runXcrun(['stapler', 'staple', archive])
      logger.success(`Notarized and stapled ${archive}`)
    } else {
      logger.success(
        `Notarized ${archive} — no staple for a zip; Gatekeeper resolves the ticket from the binary's signature online`,
      )
    }
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    logger.fail(`Sockeye notarization failed: ${errorMessage(error)}`)
    process.exitCode = 1
  })
}
