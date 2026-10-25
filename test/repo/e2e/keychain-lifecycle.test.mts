import { createReadStream, createWriteStream, writeFileSync } from 'node:fs'
import os from 'node:os'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { describe, expect, test } from 'vitest'

import {
  KEYCHAIN_CASES,
  isKeychainEvidence,
  readKeychainArtifact,
} from '../../../scripts/repo/keychain-evidence.mts'
import type { KeychainEvidence } from '../../../scripts/repo/keychain-evidence.mts'
import {
  getBinaryPath,
  getBuildMode,
  getNativeTestBinaryPath,
} from '../../../scripts/repo/paths.mts'
import {
  keychainForegroundTerminal,
  keychainSuiteAllowed,
} from '../../../scripts/repo/test-keychain-interactive.mts'

const selected =
  process.env['SOCKEYE_INTERACTIVE_TESTS'] === '1' &&
  !Object.hasOwn(process.env, 'CI') &&
  process.platform === 'darwin'
const attended =
  selected &&
  keychainSuiteAllowed(process.env, process.platform, {
    foreground: keychainForegroundTerminal(),
  })

test('observer reports fixture equality without printing credential bytes', () => {
  for (const [mode, value, status] of [
    ['initial', 'SOCKEYE_FAKE_LIFECYCLE_INITIAL', 0],
    ['replacement', 'SOCKEYE_FAKE_LIFECYCLE_REPLACEMENT', 0],
    ['initial', 'SOCKEYE_FAKE_LIFECYCLE_REPLACEMENT', 1],
    ['initial', '', 1],
  ] as const) {
    const result = spawnSync(
      getNativeTestBinaryPath('sockeye-keychain-observer'),
      [mode],
      { env: { SOCKEYE_TEST_LIFECYCLE_TOKEN: value }, encoding: 'utf8' },
    )
    expect(result.status).toBe(status)
    expect(result.stdout.trim()).toBe(
      status === 0 ? 'fixture-match' : 'fixture-mismatch',
    )
    expect(result.stderr).toBe('')
  }
})

describe.skipIf(!attended)('attended Keychain lifecycle evidence', () => {
  test('records every manually observed case without credential values', async () => {
    expect(
      keychainSuiteAllowed(process.env, process.platform, {
        foreground: keychainForegroundTerminal(),
      }),
    ).toBe(true)
    const evidenceFile = process.env['SOCKEYE_KEYCHAIN_EVIDENCE_FILE']
    if (!evidenceFile)
      throw new Error(
        'Evidence collection failed at output: expected a new evidence path. Set SOCKEYE_KEYCHAIN_EVIDENCE_FILE.',
      )
    const artifact = readKeychainArtifact(
      getBinaryPath(getBuildMode(), `${process.platform}-${process.arch}`),
    )
    expect(artifact.architecture).toBe(process.arch)
    const input = createReadStream('/dev/tty')
    const output = createWriteStream('/dev/tty')
    const terminal = createInterface({ input, output })
    const records: KeychainEvidence[] = []
    try {
      for (const testCase of KEYCHAIN_CASES) {
        const answer = await terminal.question(
          `${testCase}: enter passed:<prompt-count>, failed:<prompt-count>, or unverified after following the runbook: `,
        )
        const match = /^(passed|failed):([0-9]+)$/.exec(answer)
        const status = match?.[1] ?? 'unverified'
        const value: unknown = {
          schemaVersion: 1,
          source: process.env['SOCKEYE_KEYCHAIN_SOURCE'],
          binaryHash: artifact.binaryHash,
          os: `darwin-${os.release()}`,
          architecture: artifact.architecture,
          signingClass: process.env['SOCKEYE_KEYCHAIN_SIGNING_CLASS'],
          testCase,
          outcome:
            status === 'passed'
              ? 'expected'
              : status === 'failed'
                ? 'unexpected'
                : 'not-observed',
          promptCount: match ? Number(match[2]) : null,
          status,
        }
        if (!isKeychainEvidence(value))
          throw new Error(
            'Evidence collection failed at metadata: expected valid source, signing class, and prompt count. Check the runbook inputs.',
          )
        records.push(value)
      }
      expect(
        readKeychainArtifact(
          getBinaryPath(getBuildMode(), `${process.platform}-${process.arch}`),
        ),
      ).toEqual(artifact)
      writeFileSync(evidenceFile, `${JSON.stringify(records, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      })
    } finally {
      terminal.close()
      input.destroy()
      output.end()
    }
    expect(records.every(record => record.status === 'passed')).toBe(true)
  }, 43_200_000)
})
import { spawnSync } from 'node:child_process'
