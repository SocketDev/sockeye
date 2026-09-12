/**
 * @file Pure policy for the interactive credential setup command. The setup
 *   wrapper may ask a human which source they want, but a credential value
 *   never passes through this TypeScript process. When available, 1Password is
 *   the preferred one-time source; Keychain entry is the direct fallback.
 */

import { parseArgs } from 'node:util'

export type CredentialSource = 'keychain' | 'one-password'

export function parseCredentialSetupArgs(args: readonly string[]): {
  identifier: string
  source: 'one-password' | undefined
} {
  try {
    const { positionals, values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: true,
      options: { source: { type: 'string' } },
    })
    const identifier = positionals[0]
    if (
      positionals.length !== 1 ||
      identifier === undefined ||
      !/^[A-Z_][A-Z0-9_]{0,126}$/u.test(identifier) ||
      (values.source !== undefined && values.source !== 'one-password')
    ) {
      throw new Error('Invalid credential setup arguments.')
    }
    return { identifier, source: values.source }
  } catch {
    throw new Error(
      'Invalid credential setup arguments. Use one uppercase credential name and optional --source one-password.',
    )
  }
}

export interface CredentialSourceChoice {
  description: string
  name: string
  value: CredentialSource
}

export function credentialSourceChoices(
  hasOnePassword: boolean,
): CredentialSourceChoice[] {
  if (hasOnePassword) {
    return [
      {
        value: 'one-password',
        name: 'Import once from 1Password (recommended)',
        description:
          'Sockeye asks 1Password for one explicit op:// reference, stores it in Keychain, and never reads 1Password while running a job.',
      },
      {
        value: 'keychain',
        name: 'Enter and store in macOS Keychain',
        description:
          'Fallback when 1Password is unavailable or the credential is not stored there.',
      },
    ]
  }
  return [
    {
      value: 'keychain',
      name: 'Enter and store in macOS Keychain',
      description:
        'Sockeye reads the value only from your terminal, then protects it with current Touch ID.',
    },
  ]
}

export function isCredentialSource(value: unknown): value is CredentialSource {
  return value === 'keychain' || value === 'one-password'
}

export function isOnePasswordReference(value: string): boolean {
  return (
    value.startsWith('op://') &&
    value.length > 'op://'.length &&
    Buffer.byteLength(value) <= 2048 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}
