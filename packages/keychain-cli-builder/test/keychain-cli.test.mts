/**
 * @file Non-destructive CLI contract tests. Missing reads and deletes do not
 *   create Keychain entries or show a biometric prompt. Invalid set input is
 *   rejected before the platform backend is called.
 */

import { existsSync } from 'node:fs'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { getKeychainCliBinaryPath } from '../scripts/paths.mts'

const target = `${process.platform}-${process.arch}`
const binaryPath = getKeychainCliBinaryPath('dev', target)
const built = existsSync(binaryPath)
const service = 'socket-keychain-cli-test-missing'
const account = 'NOPE'

// A non-biometric slot named like the fleet's real Fireworks slot so the
// contract mirrors production. No value is stored: the harness asserts CLI
// contract, never a live keychain write.
const silentService = 'socket-keychain-cli-test-silent'
const silentAccount = 'fireworks-api-key'

describe.skipIf(!built)('socket-keychain CLI', () => {
  it('reports its version and command help', () => {
    const version = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' })
    expect(version.status).toBe(0)
    expect(version.stdout).toMatch(/^socket-keychain /u)

    const help = spawnSync(binaryPath, ['--help'], { encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('set [--silent] <service> <account>')
  })

  it('uses exit code 3 for a missing credential', () => {
    const result = spawnSync(binaryPath, ['get', service, account], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(3)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('not found')
  })

  it('treats deleting a missing credential as success', () => {
    const result = spawnSync(binaryPath, ['delete', service, account], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('rejects empty and oversized stdin before storing', () => {
    const empty = spawnSync(binaryPath, ['set', service, account], {
      encoding: 'utf8',
      input: '',
    })
    expect(empty.status).toBe(2)

    const oversized = spawnSync(binaryPath, ['set', service, account], {
      encoding: 'utf8',
      input: 'x'.repeat(8192),
    })
    expect(oversized.status).toBe(2)
  })
})

// Contract-only, like the biometric suite above: no live keychain write in the
// harness (a spawned worker cannot answer the OS access prompt, so a live
// write→read hangs then fails). The behavioral silent round-trip is proven by
// direct-binary exercise on a real GUI session, not here.
describe.skipIf(!built)('socket-keychain silent slot', () => {
  it('lists --silent in usage for get and set', () => {
    const help = spawnSync(binaryPath, ['--help'], { encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('get [--silent] <service> <account>')
    expect(help.stdout).toContain('set [--silent] <service> <account>')
  })

  it('accepts --silent and reports a missing credential as exit 3', () => {
    const result = spawnSync(
      binaryPath,
      ['get', '--silent', silentService, silentAccount],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(3)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('not found')
  })

  it('rejects empty and oversized --silent set stdin before storing', () => {
    const empty = spawnSync(
      binaryPath,
      ['set', '--silent', silentService, silentAccount],
      { encoding: 'utf8', input: '' },
    )
    expect(empty.status).toBe(2)

    const oversized = spawnSync(
      binaryPath,
      ['set', '--silent', silentService, silentAccount],
      { encoding: 'utf8', input: 'x'.repeat(8192) },
    )
    expect(oversized.status).toBe(2)
  })

  it('rejects --silent on delete', () => {
    const result = spawnSync(
      binaryPath,
      ['delete', '--silent', silentService, silentAccount],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(2)
  })
})
