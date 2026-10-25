import { describe, expect, test } from 'vitest'

import {
  credentialSourceChoices,
  isCredentialSource,
  isOnePasswordReference,
  parseCredentialSetupArgs,
} from '../../../scripts/repo/setup-credential-contract.mts'

const binding = 'a'.repeat(64)

describe('credential setup policy', () => {
  test('prefers 1Password when it is available and falls back to Keychain', () => {
    expect(credentialSourceChoices(false)).toEqual([
      expect.objectContaining({ value: 'keychain' }),
    ])
    expect(credentialSourceChoices(true)).toEqual([
      expect.objectContaining({ value: 'one-password' }),
      expect.objectContaining({ value: 'keychain' }),
    ])
  })

  test('accepts only explicit, printable one-time 1Password references', () => {
    expect(isOnePasswordReference('op://Vault/item/credential')).toBe(true)
    expect(isOnePasswordReference('https://Vault/item/credential')).toBe(false)
    expect(isOnePasswordReference('op://Vault/item\ncredential')).toBe(false)
    expect(isCredentialSource('keychain')).toBe(true)
    expect(isCredentialSource('runtime-1password')).toBe(false)
  })
})

test('parses a required 1Password source without a secret value', () => {
  expect(
    parseCredentialSetupArgs([
      'EXAMPLE_API_TOKEN',
      '--binding',
      binding,
      '--source',
      'one-password',
    ]),
  ).toEqual({
    bindingId: binding,
    identifier: 'EXAMPLE_API_TOKEN',
    source: 'one-password',
  })
  expect(
    parseCredentialSetupArgs(['EXAMPLE_API_TOKEN', '--binding', binding]),
  ).toEqual({
    bindingId: binding,
    identifier: 'EXAMPLE_API_TOKEN',
    source: undefined,
  })
})
test.each([
  [],
  ['EXAMPLE_API_TOKEN', 'value'],
  ['EXAMPLE_API_TOKEN', '--binding', 'A'.repeat(64)],
  ['lowercase'],
  ['EXAMPLE_API_TOKEN', '--source', 'keychain'],
  ['EXAMPLE_API_TOKEN', '--source'],
  ['EXAMPLE_API_TOKEN', '--unknown'],
])('rejects unsupported setup arguments %j', (...args) => {
  expect(() => parseCredentialSetupArgs(args)).toThrow()
})

test('argument diagnostics do not echo unknown input', () => {
  expect(() =>
    parseCredentialSetupArgs(['EXAMPLE_API_TOKEN', '--FAKE_PRIVATE_ARGUMENT']),
  ).toThrow(
    expect.objectContaining({
      message: expect.not.stringContaining('FAKE_PRIVATE_ARGUMENT'),
    }),
  )
})
