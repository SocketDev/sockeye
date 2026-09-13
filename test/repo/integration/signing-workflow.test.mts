import { readFileSync } from 'node:fs'
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
  jobs: {
    'build-sign': {
      env: Record<string, string>
      steps: WorkflowStep[]
      strategy: { matrix: { arch: string[] } }
    }
  }
}
const job = workflow.jobs['build-sign']
function signingStep(name: string): WorkflowStep {
  const step = job.steps.find(candidate => candidate.name === name)
  if (!step) throw new Error(`Missing signing workflow step: ${name}`)
  return step
}

test('builds and signs production bytes from the immutable triggering commit', () => {
  expect(job.env['BUILD_MODE']).toBe('prod')
  expect(job.env['SOCKEYE_TARGET_ARCH']).toBe('${{ matrix.arch }}')
  expect(job.strategy.matrix['arch']).toEqual(['arm64', 'x64'])
  expect(signingStep('Bootstrap checkout').env?.['TRIGGER_REF']).toBe(
    '${{ github.sha }}',
  )
  expect(signingStep('Build prod binary').run).toBe('pnpm run build')
  expect(
    signingStep('Sign with developer id').env?.['SOCKEYE_SIGNING_IDENTITY'],
  ).toBeUndefined()
  expect(signingStep('Sign with developer id').run).toContain(
    'build/prod/darwin-${{ matrix.arch }}/out/Final/sockeye',
  )
  expect(signingStep('Verify signed binary starts').run).toContain(
    'build/prod/darwin-${{ matrix.arch }}/out/Final/"$SOCKEYE_BUNDLE_NAME"/Contents/MacOS/sockeye --help',
  )
  expect(signingStep('Sign ad-hoc').run).toContain(
    'pnpm run sign --ad-hoc --run build/prod/darwin-${{ matrix.arch }}/out/Final/sockeye',
  )
})

test('requires public signing and notarization unless ad-hoc mode is explicit', () => {
  for (const name of [
    'Import codesign certificate',
    'Sign with developer id',
    'Store notarytool credentials',
    'Notarize archive',
    'Verify release artifact',
  ]) {
    expect(signingStep(name).if).toBe('${{ !inputs.adhoc }}')
  }
  for (const name of ['Sign ad-hoc', 'Verify ad-hoc signature']) {
    expect(signingStep(name).if).toBe('${{ inputs.adhoc }}')
  }
  expect(signingStep('Upload artifact').with?.['name']).toContain(
    'sockeye-darwin-${{ matrix.arch }}',
  )
  expect(signingStep('Upload artifact').with?.['name']).toContain('-adhoc')
})

test('verifies the exact notarized archive before upload', () => {
  expect(signingStep('Verify release artifact').run).toBe(
    'pnpm run verify-release build/prod/darwin-${{ matrix.arch }}/out/Final/sockeye-darwin-${{ matrix.arch }}.zip',
  )
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
