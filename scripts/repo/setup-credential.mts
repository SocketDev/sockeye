#!/usr/bin/env node
import { getScriptArgs, scriptStdio } from '../fleet/process/script-output.mts'
/**
 * @file Human-only credential setup with Socket Lib prompts.
 *   Usage: `pnpm run setup:credential -- SOCKET_RELEASE_APP_PRIVATE_KEY`
 *   This process handles names and a non-secret 1Password reference only. The
 *   native Sockeye executable reads either terminal input or 1Password stdout,
 *   then puts the secret directly into Touch-ID-protected Keychain storage.
 */

import { constants, existsSync, realpathSync } from 'node:fs'
import { access } from 'node:fs/promises'
import process from 'node:process'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import {
  confirm,
  input,
  select,
} from '@socketsecurity/lib-stable/stdio/prompts'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { authorizeOnePasswordTerminal } from '@socketsecurity/lib-stable/secrets/one-password'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import { getBinaryPath, getBuildMode } from './paths.mts'
import {
  credentialSourceChoices,
  isCredentialSource,
  isOnePasswordReference,
} from './setup-credential-contract.mts'

import {
  onePasswordEnvironment,
  selectOnePasswordReference,
} from './one-password-metadata.mts'
import type { OnePasswordSelection } from './one-password-metadata.mts'

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Store one credential in Sockeye Keychain through guided 1Password import or hidden terminal entry.',
  help: 'Usage: pnpm run setup:credential -- <UPPERCASE_CREDENTIAL_NAME>\nRequires a foreground terminal and Touch ID. Guided import lists account, vault, and item metadata before requesting the field reference.',
  json: 'result',
}

const ONE_PASSWORD_PATHS = ['/opt/homebrew/bin/op', '/usr/local/bin/op']

async function findOnePassword(): Promise<string | undefined> {
  for (
    let index = 0, { length } = ONE_PASSWORD_PATHS;
    index < length;
    index += 1
  ) {
    const candidate = ONE_PASSWORD_PATHS[index]!
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the other supported, fixed installation location.
    }
  }
  return undefined
}

function usage(): never {
  throw new Error(
    'Usage: pnpm run setup:credential -- <UPPERCASE_CREDENTIAL_NAME>',
  )
}

async function runNative(
  args: string[],
  options?: { account?: string | undefined } | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const account = opts.account
  const binary = getBinaryPath(
    getBuildMode(),
    `${process.platform}-${process.arch}`,
  )
  if (!existsSync(binary)) {
    throw new Error(
      `Sockeye is not built. Run "pnpm run build" first (${binary}).`,
    )
  }
  const result = await spawn(binary, args, {
    stdio: scriptStdio('inherit'),
    ...(account ? { env: onePasswordEnvironment({ account }) } : {}),
  })
  if (result.code !== 0) {
    throw new Error(
      `Sockeye credential setup failed with exit code ${result.code}`,
    )
  }
}

async function manualOnePasswordReference(): Promise<
  OnePasswordSelection | undefined
> {
  const account = await input(
    {
      message: '1Password account sign-in address or user ID:',
    },
    { output: process.stderr },
  )
  if (typeof account !== 'string' || !/^[a-zA-Z0-9.-]{1,512}$/.test(account)) {
    return undefined
  }
  const reference = await input(
    {
      message:
        'Full 1Password reference (op://Vault/item/field), not its secret value:',
    },
    { output: process.stderr },
  )
  if (typeof reference !== 'string' || !isOnePasswordReference(reference)) {
    return undefined
  }
  return { account, reference }
}

export async function authorizeOnePasswordAccount(
  executable: string,
  account: string,
): Promise<void> {
  const resolved = whichSync('op', { path: getEnvValue('PATH'), nothrow: true })
  if (
    typeof resolved !== 'string' ||
    realpathSync(resolved) !== realpathSync(executable)
  ) {
    throw new Error(
      '1Password CLI selection differs from PATH. Put the supported op installation first in PATH and retry.',
    )
  }
  process.stderr.write(
    'Enable 1Password Settings > Developer > Integrate with 1Password CLI, unlock the desktop app, and approve this terminal.\n',
  )
  let status: string
  try {
    status = (await authorizeOnePasswordTerminal({ account })).status
  } catch {
    status = 'authorization-failed'
  }
  if (status !== 'authorized') {
    throw new Error(
      `1Password terminal authorization failed (${status}). Check desktop CLI integration and retry from the foreground terminal.`,
    )
  }
}

export async function chooseOnePasswordReference(
  executable: string,
  options: { credentialName?: string | undefined } = {},
): Promise<OnePasswordSelection | undefined> {
  const method = await select(
    {
      message: 'How should Sockeye locate the 1Password field?',
      choices: [
        {
          name: 'Choose account, vault, and item (recommended)',
          value: 'guided',
        },
        { name: 'Enter account and full reference', value: 'reference' },
      ],
    },
    { output: process.stderr },
  )
  if (method === 'reference') {
    const selected = await manualOnePasswordReference()
    if (selected) {
      await authorizeOnePasswordAccount(executable, selected.account)
    }
    return selected
  }
  if (method !== 'guided') {
    return undefined
  }
  return await selectOnePasswordReference(
    executable,
    {
      authorize: async account =>
        await authorizeOnePasswordAccount(executable, account),
      choose: async (message, choices) =>
        await select({ message, choices }, { output: process.stderr }),
      field: async message =>
        await input({ message }, { output: process.stderr }),
    },
    { credentialName: options.credentialName },
  )
}

async function main(): Promise<void> {
  const [identifier, ...extra] = getScriptArgs()
  if (
    identifier === undefined ||
    extra.length > 0 ||
    !/^[A-Z_][A-Z0-9_]{0,126}$/u.test(identifier)
  ) {
    usage()
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Credential setup requires a foreground terminal.')
  }
  const executable = await findOnePassword()
  const source = await select(
    {
      message: `How should Sockeye set ${identifier}?`,
      choices: credentialSourceChoices(Boolean(executable)),
    },
    { output: process.stderr },
  )
  if (!isCredentialSource(source)) {
    return
  }
  if (source === 'keychain') {
    await runNative(['set', identifier])
    return
  }

  if (!executable) {
    return
  }
  const selected = await chooseOnePasswordReference(executable, {
    credentialName: identifier,
  })
  if (!selected) {
    return
  }
  const approved = await confirm(
    {
      message: `Import ${identifier} from ${selected.reference} in account ${selected.account} into Touch-ID-protected Keychain?`,
      default: false,
    },
    { output: process.stderr },
  )
  if (approved !== true) {
    return
  }
  await runNative(['import-1password', identifier, selected.reference], {
    account: selected.account,
  })
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
