/**
 * @file Non-destructive native CLI contract tests. These cases stop before
 *   LocalAuthentication or Keychain access, so they are safe in unattended CI.
 */

import process from 'node:process'

import { describe, expect, test } from 'vitest'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  getBinaryPath,
  getBuildMode,
  getNativeTestBinaryPath,
} from '../../../scripts/repo/paths.mts'

const binaryPath = getBinaryPath(
  getBuildMode(),
  `${process.platform}-${process.arch}`,
)
const binding = 'a'.repeat(64)

describe('Sockeye CLI', () => {
  test('runs the native malformed and boundary byte policy checks', () => {
    const result = spawnSync(
      getNativeTestBinaryPath('sockeye-input-policy-test'),
      [],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  test('fails closed when the approved child changes or its wait fails', () => {
    const result = spawnSync(
      getNativeTestBinaryPath('sockeye-child-process-test'),
      [],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  test('reports its version and security-shaped help', () => {
    const version = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' })
    expect(version.status).toBe(0)
    expect(version.stdout).toMatch(/^sockeye /u)

    const help = spawnSync(binaryPath, ['--help'], { encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('sockeye run --credential')
    expect(help.stdout).toContain(
      'no command that returns credential plaintext',
    )
    expect(help.stdout).not.toContain('sockeye get')
  })

  test('reports binding support without authorizing or reading credentials', () => {
    const result = spawnSync(binaryPath, ['capabilities'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      'sockeye-capabilities-v1\ncredential-bindings: sha256-64-lowercase-hex\ncredential-verify: attended-protected-readback-v1\ncredential-storage: keychain-biometry-current-set-device-only',
    )
    expect(result.stderr).toBe('')
  })

  test('does not expose a raw get command', () => {
    const result = spawnSync(binaryPath, ['get', 'SOCKET_TEST_TOKEN'], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
  })

  test('rejects malformed credential names before reading stdin', () => {
    const canary = 'sockeye-secret-canary'
    const result = spawnSync(
      binaryPath,
      ['set', 'bad-name', '--binding', binding],
      {
        encoding: 'utf8',
        input: canary,
      },
    )
    expect(result.status).toBe(2)
    expect(`${result.stdout}${result.stderr}`).not.toContain(canary)
  })

  test('rejects malformed 1Password imports before authentication', () => {
    const result = spawnSync(
      binaryPath,
      [
        'import-1password',
        'SOCKET_TEST_TOKEN',
        'https://not-a-reference',
        '--binding',
        binding,
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('reference must be a printable op://')
  })

  test('rejects duplicate and wildcard manifest credentials', () => {
    const duplicate = spawnSync(
      binaryPath,
      [
        'run',
        '--credential',
        'SOCKET_TEST_TOKEN',
        '--binding',
        binding,
        '--credential',
        'SOCKET_TEST_TOKEN',
        '--binding',
        binding,
        '--cwd',
        process.cwd(),
        '--',
        '/usr/bin/true',
      ],
      { encoding: 'utf8' },
    )
    expect(duplicate.status).toBe(2)
    expect(duplicate.stderr).toContain('duplicate --credential')

    const wildcard = spawnSync(
      binaryPath,
      [
        'run',
        '--credential',
        'SOCKET_*',
        '--binding',
        binding,
        '--cwd',
        process.cwd(),
        '--',
        '/usr/bin/true',
      ],
      { encoding: 'utf8' },
    )
    expect(wildcard.status).toBe(2)
    expect(wildcard.stderr).toContain('must match')
  })

  test('requires an absolute child and working directory', () => {
    const child = spawnSync(
      binaryPath,
      [
        'run',
        '--credential',
        'SOCKET_TEST_TOKEN',
        '--binding',
        binding,
        '--cwd',
        process.cwd(),
        '--',
        'true',
      ],
      { encoding: 'utf8' },
    )
    expect(child.status).toBe(2)
    expect(child.stderr).toContain('paths must be absolute')

    const cwd = spawnSync(
      binaryPath,
      [
        'run',
        '--credential',
        'SOCKET_TEST_TOKEN',
        '--binding',
        binding,
        '--cwd',
        '.',
        '--',
        '/usr/bin/true',
      ],
      { encoding: 'utf8' },
    )
    expect(cwd.status).toBe(2)
    expect(cwd.stderr).toContain('--cwd must be an absolute path')
  })
})
