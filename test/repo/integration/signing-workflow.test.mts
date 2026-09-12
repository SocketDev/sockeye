import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'
import { parse } from 'yaml'

interface WorkflowStep {
  name: string
  id?: string
  if?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, string>
}

const workflow = parse(
  readFileSync(
    new URL('../../../.github/workflows/repo-sign-macos.yml', import.meta.url),
    'utf8',
  ),
) as {
  jobs: { 'build-sign': { env: Record<string, string>; steps: WorkflowStep[] } }
}
const job = workflow.jobs['build-sign']
function signingStep(name: string): WorkflowStep {
  const step = job.steps.find(candidate => candidate.name === name)
  if (!step) throw new Error(`Missing signing workflow step: ${name}`)
  return step
}

test('builds and signs production bytes from the immutable triggering commit', () => {
  expect(job.env['BUILD_MODE']).toBe('prod')
  expect(signingStep('Bootstrap checkout').env?.['TRIGGER_REF']).toBe(
    '${{ github.sha }}',
  )
  expect(signingStep('Build prod binary').run).toBe('pnpm run build')
  expect(
    signingStep('Sign with developer id').env?.['SOCKEYE_SIGNING_IDENTITY'],
  ).toBe('Developer ID Application: Socket Inc. (PZRCDQ736X)')
  expect(signingStep('Sign with developer id').run).toBe('pnpm run sign --run')
  expect(signingStep('Sign ad-hoc').run).toBe('pnpm run sign --ad-hoc --run')
})

test('requires public signing and notarization unless ad-hoc mode is explicit', () => {
  for (const name of [
    'Import codesign certificate',
    'Sign with developer id',
    'Store notarytool credentials',
    'Notarize archive',
    'Verify developer signature',
  ]) {
    expect(signingStep(name).if).toBe('${{ !inputs.adhoc }}')
  }
  for (const name of ['Sign ad-hoc', 'Verify ad-hoc signature']) {
    expect(signingStep(name).if).toBe('${{ inputs.adhoc }}')
  }
  expect(signingStep('Upload artifact').with?.['name']).toContain(
    'sockeye-darwin-arm64-adhoc',
  )
})

test('verifies the signed binary with the expected Apple identity and team', () => {
  const result = spawnSync(
    '/bin/bash',
    [
      '-euo',
      'pipefail',
      '-c',
      `codesign() { printf '%s\\n' "$@"; }\n${signingStep('Verify developer signature').run}`,
    ],
    { encoding: 'utf8' },
  )
  expect(result.status).toBe(0)
  expect(result.stdout.trim().split(/\r?\n/u)).toEqual([
    '--verify',
    '--strict',
    '--verbose=4',
    '-R',
    '=anchor apple generic and identifier "dev.socket.sockeye" and certificate leaf[subject.OU] = "PZRCDQ736X" and certificate leaf[subject.CN] = "Developer ID Application: Socket Inc. (PZRCDQ736X)"',
    'build/prod/darwin-arm64/out/Final/sockeye',
  ])
})

test('signature verification failure fails the workflow step', () => {
  const result = spawnSync(
    '/bin/bash',
    [
      '-euo',
      'pipefail',
      '-c',
      `codesign() { return 1; }\n${signingStep('Verify developer signature').run}`,
    ],
    { encoding: 'utf8' },
  )
  expect(result.status).toBe(1)
})

test('cleans up imported certificates even after a failed signing step', () => {
  const cleanup = signingStep('Clean up signing keychain')
  expect(cleanup.if).toBe('${{ always() && !inputs.adhoc }}')
  expect(cleanup.with?.['mode']).toBe('cleanup')
  expect(signingStep('Import codesign certificate').id).toBe('import-signing')
  expect(cleanup.with?.['temporary-directory']).toBe(
    '${{ steps.import-signing.outputs.temporary-directory }}',
  )
  for (const name of ['Store notarytool credentials', 'Notarize archive']) {
    expect(signingStep(name).env?.['SOCKEYE_SIGNING_KEYCHAIN']).toBe(
      '${{ steps.import-signing.outputs.keychain }}',
    )
  }
  expect(job.steps.at(-1)).toBe(cleanup)
})
