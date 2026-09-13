#!/usr/bin/env node
import {
  getScriptArgs,
  getScriptLogger,
  scriptStdio,
} from '../fleet/process/script-output.mts'
/**
 * @file Sign Sockeye release binaries with the hardened runtime
 *   (release-checklist step 5). Dry-run is the default and prints the exact
 *   codesign invocations with their preconditions. `--run` executes them and
 *   requires a Developer ID Application identity via `--identity` or
 *   `SOCKEYE_SIGNING_IDENTITY`. `--ad-hoc` really signs with the ad-hoc
 *   identity (no certificate needed) so the flow is verifiable locally;
 *   ad-hoc signatures cannot carry a secure timestamp, so `--timestamp` is
 *   only passed for Developer ID runs.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { parseArgs } from 'node:util'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import { getBinaryPath, getBuildMode } from './paths.mts'

import {
  prepareReleaseBundle,
  RELEASE_BUNDLE_NAME,
  RELEASE_IDENTIFIER,
} from './release/bundle.mts'

const logger = getScriptLogger()

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Sign Sockeye binaries with the hardened runtime; print commands unless execution is requested.',
  help: 'Usage: pnpm run sign [options] [paths…]\n\n  --run                sign with a Developer ID Application identity\n  --ad-hoc             sign with the ad-hoc identity\n  --identity <name>    identity (default: $SOCKEYE_SIGNING_IDENTITY)\n  --entitlements <p>   entitlements plist\n\nPaths default to the built binary for the current mode.',
  json: 'result',
}

export const SIGNING_IDENTIFIER = RELEASE_IDENTIFIER
export const SIGNING_IDENTITY_ENV = 'SOCKEYE_SIGNING_IDENTITY'
export const SIGNING_ENTITLEMENTS = path.join(
  REPO_ROOT,
  'src',
  'sockeye',
  'sockeye.entitlements',
)

export interface SignPlan {
  entitlements: string | undefined
  identity: string
  target: string
  timestamp: boolean
}

export function codesignArgs(plan: SignPlan): string[] {
  const args = ['--force', '--options', 'runtime']
  if (plan.timestamp) {
    args.push('--timestamp')
  }
  if (plan.entitlements !== undefined) {
    args.push('--entitlements', plan.entitlements)
  }
  args.push('--identifier', SIGNING_IDENTIFIER, '--sign', plan.identity)
  args.push(plan.target)
  return args
}

export function displayCommand(command: string, args: string[]): string {
  const rendered = args.map(part =>
    /^[\w./=@-]+$/u.test(part) ? part : `'${part}'`,
  )
  return [command, ...rendered].join(' ')
}

async function runCodesign(args: string[]): Promise<void> {
  const result = await spawn('/usr/bin/codesign', args, {
    cwd: REPO_ROOT,
    stdio: scriptStdio('inherit'),
  })
  if (result.code !== 0) {
    throw new Error(`codesign failed with exit code ${result.code}`)
  }
}

export function signingEntitlements(
  config: Readonly<{ adHoc: boolean; requested: string | undefined }>,
): string | undefined {
  const adHoc = config.adHoc
  const requested = config.requested
  if (adHoc && requested !== undefined) {
    throw new Error(
      'Ad-hoc signing cannot claim Sockeye release entitlements; use Developer ID signing',
    )
  }
  return adHoc ? undefined : (requested ?? SIGNING_ENTITLEMENTS)
}

function signingPlans(positionals: string[], values: Record<string, unknown>) {
  const adHoc = values['ad-hoc'] === true
  const execute = adHoc || values['run'] === true
  const requestedEntitlements =
    typeof values['entitlements'] === 'string'
      ? values['entitlements']
      : undefined
  const entitlements = signingEntitlements({
    adHoc,
    requested: requestedEntitlements,
  })
  const configuredIdentity =
    typeof values['identity'] === 'string'
      ? values['identity']
      : getEnvValue(SIGNING_IDENTITY_ENV)
  const targets =
    positionals.length > 0
      ? positionals.map(String)
      : [getBinaryPath(getBuildMode(), `${process.platform}-${process.arch}`)]

  if (entitlements !== undefined && !existsSync(entitlements)) {
    throw new Error(
      `Entitlements file not found at ${entitlements}; pass an existing plist to --entitlements`,
    )
  }
  if (!adHoc && execute && configuredIdentity === undefined) {
    throw new Error(
      `No signing identity: pass --identity or set ${SIGNING_IDENTITY_ENV} to the Developer ID Application identity in the login keychain, or use --ad-hoc for a local certificate-free run`,
    )
  }

  const identity = adHoc
    ? '-'
    : (configuredIdentity ?? `$${SIGNING_IDENTITY_ENV}`)
  const plans: SignPlan[] = targets.map(target => ({
    __proto__: null,
    entitlements,
    identity,
    target,
    timestamp: !adHoc,
  }))

  return { __proto__: null, adHoc, execute, plans }
}

async function prepareSigningTarget(
  target: string,
  values: Record<string, unknown>,
): Promise<string> {
  const profile =
    typeof values['profile'] === 'string'
      ? values['profile']
      : getEnvValue('SOCKEYE_PROVISIONING_PROFILE')
  if (!profile) {
    throw new Error(
      'Sockeye signing requires a Developer ID provisioning profile. Set SOCKEYE_PROVISIONING_PROFILE to the Apple-issued profile path.',
    )
  }
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  )
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) {
    throw new Error(
      'Sockeye package version is missing; repair package.json before signing.',
    )
  }
  return prepareReleaseBundle(target, profile, manifest.version)
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Sockeye signing refused on ${process.platform}; codesign requires macOS`,
    )
  }
  const { positionals, values } = parseArgs({
    args: getScriptArgs(),
    options: {
      'ad-hoc': { default: false, type: 'boolean' },
      entitlements: { type: 'string' },
      help: { default: false, type: 'boolean' },
      identity: { type: 'string' },
      profile: { type: 'string' },
      run: { default: false, type: 'boolean' },
    },
    allowPositionals: true,
    strict: false,
  })
  if (values['help']) {
    logger.log('Usage: pnpm run sign -- [options] [paths…]')
    logger.log('')
    logger.log('  default              dry run: print the exact codesign calls')
    logger.log('  --run                execute with the Developer ID identity')
    logger.log('  --ad-hoc             execute with the ad-hoc identity (-)')
    logger.log('  --identity <name>    Developer ID Application identity')
    logger.log(`                       (default: $${SIGNING_IDENTITY_ENV})`)
    logger.log('  --entitlements <p>   entitlements plist to embed')
    logger.log('')
    logger.log('  paths default to the built binary for the current mode')
    return
  }

  const { adHoc, execute, plans } = signingPlans(positionals, values)

  if (!execute) {
    logger.info('Dry run — no signature is written. Exact invocations:')
    for (let i = 0, { length } = plans; i < length; i += 1) {
      logger.log(
        `  ${displayCommand('/usr/bin/codesign', codesignArgs(plans[i]!))}`,
      )
    }
    logger.log('')
    logger.log('Preconditions:')
    logger.log(
      `  - the Developer ID Application certificate named by $${SIGNING_IDENTITY_ENV} is in the login keychain`,
    )
    logger.log('  - each target path exists (run "pnpm run build" first)')
    logger.log(
      '  - --timestamp reaches Apple’s timestamp service, so the run needs network access',
    )
    logger.log(
      'Run with --run to sign, or --ad-hoc for a certificate-free local pass.',
    )
    return
  }

  for (let i = 0, { length } = plans; i < length; i += 1) {
    const plan = plans[i]!
    if (!existsSync(plan.target)) {
      throw new Error(
        `Nothing to sign at ${plan.target}; run "pnpm run build" first`,
      )
    }
    if (!adHoc) {
      plan.target = await prepareSigningTarget(plan.target, values)
    }
    logger.info(
      `Signing ${plan.target} (${adHoc ? 'ad-hoc' : 'Developer ID'})…`,
    )
    logger.log(`  ${displayCommand('/usr/bin/codesign', codesignArgs(plan))}`)
    await runCodesign(codesignArgs(plan))
    await runCodesign(['--verify', '--strict', '--verbose=2', plan.target])
    logger.success(`Signed and verified ${plan.target}`)
  }
  const githubEnvironment = getEnvValue('GITHUB_ENV')
  if (githubEnvironment) {
    appendFileSync(
      githubEnvironment,
      `SOCKEYE_BUNDLE_NAME=${RELEASE_BUNDLE_NAME}\n`,
    )
  }
  if (adHoc) {
    logger.warn(
      'Ad-hoc signature: certificate-free signing mechanics only; Data Protection Keychain access requires the Developer ID release signature',
    )
  }
}

if (isMainModule(import.meta.url)) {
  runMain(
    () =>
      main().catch((error: unknown) => {
        logger.fail(`Sockeye signing failed: ${errorMessage(error)}`)
        process.exitCode = 1
      }),
    SCRIPT_META,
  )
}
