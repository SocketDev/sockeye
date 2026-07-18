import { describe, expect, test } from 'vitest'

import {
  credentialSourceChoices,
  isCredentialSource,
  isOnePasswordReference,
} from '../../../scripts/repo/setup-credential-contract.mts'

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
