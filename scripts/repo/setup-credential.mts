#!/usr/bin/env node
/**
 * @file Human-only credential setup with Socket Lib prompts.
 *   Usage: pnpm run setup:credential -- SOCKET_RELEASE_APP_PRIVATE_KEY
 *   This process handles names and a non-secret 1Password reference only. The
 *   native Sockeye executable reads either terminal input or 1Password stdout,
 *   then puts the secret directly into Touch-ID-protected Keychain storage.
 */

import { constants, existsSync } from 'node:fs'
import { access } from 'node:fs/promises'
import process from 'node:process'

import { confirm, input, select } from '@socketsecurity/lib/stdio/prompts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/_shared/is-main-module.mts'
import { getBinaryPath, getBuildMode } from './paths.mts'
import {
  credentialSourceChoices,
  isCredentialSource,
  isOnePasswordReference,
} from './setup-credential-contract.mts'

const ONE_PASSWORD_PATHS = ['/opt/homebrew/bin/op', '/usr/local/bin/op']

async function hasOnePassword(): Promise<boolean> {
  for (
    let index = 0, { length } = ONE_PASSWORD_PATHS;
    index < length;
    index += 1
  ) {
    const candidate = ONE_PASSWORD_PATHS[index]!
    try {
      await access(candidate, constants.X_OK)
      return true
    } catch {
      // Try the other supported, fixed installation location.
    }
  }
  return false
}

function usage(): never {
  throw new Error(
    'Usage: pnpm run setup:credential -- <UPPERCASE_CREDENTIAL_NAME>',
  )
}

async function runNative(args: string[]): Promise<void> {
  const binary = getBinaryPath(
    getBuildMode(),
    `${process.platform}-${process.arch}`,
  )
  if (!existsSync(binary)) {
    throw new Error(
      `Sockeye is not built. Run "pnpm run build" first (${binary}).`,
    )
  }
  const result = await spawn(binary, args, { stdio: 'inherit' })
  if (result.code !== 0) {
    throw new Error(
      `Sockeye credential setup failed with exit code ${result.code}`,
    )
  }
}

async function main(): Promise<void> {
  const [identifier, ...extra] = process.argv.slice(2)
  if (
    identifier === undefined ||
    extra.length > 0 ||
    !/^[A-Z_][A-Z0-9_]{0,126}$/u.test(identifier)
  ) {
    usage()
  }

  const source = await select({
    message: `How should Sockeye set ${identifier}?`,
    choices: credentialSourceChoices(await hasOnePassword()),
  })
  if (!isCredentialSource(source)) {
    return
  }
  if (source === 'keychain') {
    await runNative(['set', identifier])
    return
  }

  const reference = await input({
    message: '1Password reference (for example, op://Vault/item/field):',
    validate(value: string) {
      return (
        isOnePasswordReference(value) ||
        'Enter a printable op:// reference of at most 2048 characters.'
      )
    },
  })
  if (typeof reference !== 'string' || !isOnePasswordReference(reference)) {
    return
  }
  const approved = await confirm({
    message: `Import ${identifier} from this 1Password reference into Touch-ID-protected Keychain?`,
    default: false,
  })
  if (approved !== true) {
    return
  }
  await runNative(['import-1password', identifier, reference])
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  })
}
