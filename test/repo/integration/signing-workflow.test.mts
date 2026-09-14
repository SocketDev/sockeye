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

interface WorkflowJob {
  env?: Record<string, string>
  if?: string
  needs?: string
  permissions?: Record<string, string>
  steps: WorkflowStep[]
  strategy?: { matrix: { arch: string[] } }
}

const workflow = parse(
  readFileSync(
    new URL('../../../.github/workflows/repo-sign-macos.yml', import.meta.url),
    'utf8',
  ),
) as {
  jobs: {
    'build-sign': WorkflowJob
    'release-assets': WorkflowJob
  }
}
const job = workflow.jobs['build-sign']
const releaseJob = workflow.jobs['release-assets']
function signingStep(name: string): WorkflowStep {
  const step = job.steps.find(candidate => candidate.name === name)
  if (!step) throw new Error(`Missing signing workflow step: ${name}`)
  return step
}

function releaseStep(name: string): WorkflowStep {
  const step = releaseJob.steps.find(candidate => candidate.name === name)
  if (!step) throw new Error(`Missing release workflow step: ${name}`)
  return step
}

test('builds and signs production bytes from the immutable triggering commit', () => {
  expect(job.env?.['BUILD_MODE']).toBe('prod')
  expect(job.env?.['SOCKEYE_TARGET_ARCH']).toBe('${{ matrix.arch }}')
  expect(job.strategy?.matrix['arch']).toEqual(['arm64', 'x64'])
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
    'Notarize, staple, and package application',
    'Verify release artifact',
  ]) {
    expect(signingStep(name).if).toBe('${{ !inputs.adhoc }}')
  }
  for (const name of ['Sign ad-hoc', 'Verify ad-hoc signature']) {
    expect(signingStep(name).if).toBe('${{ inputs.adhoc }}')
  }
  expect(signingStep('Upload signed artifact').with?.['name']).toContain(
    'sockeye-darwin-${{ matrix.arch }}',
  )
  expect(signingStep('Upload signed artifact').with?.['path']).toContain(
    '.zip.notary-receipt.json',
  )
  expect(signingStep('Upload signed artifact').with?.['path']).toContain(
    '.zip.notary-submission.zip',
  )
  expect(signingStep('Upload signed artifact').with?.['path']).toContain(
    '.zip.notary-log.json',
  )
  expect(signingStep('Upload ad-hoc artifact').with?.['name']).toContain(
    '-adhoc',
  )
})

test('verifies the exact notarized archive before upload', () => {
  const packaging = signingStep('Notarize, staple, and package application')
  expect(packaging.run).toContain(
    '--bundle build/prod/darwin-${{ matrix.arch }}/out/Final/$SOCKEYE_BUNDLE_NAME',
  )
  expect(packaging.run).toContain(
    '--output build/prod/darwin-${{ matrix.arch }}/out/Final/sockeye-darwin-${{ matrix.arch }}.zip',
  )
  expect(signingStep('Verify release artifact').run).toBe(
    'pnpm run verify-release build/prod/darwin-${{ matrix.arch }}/out/Final/sockeye-darwin-${{ matrix.arch }}.zip',
  )
  expect(signingStep('Compute checksum').run).toContain(
    '> sockeye-darwin-${{ matrix.arch }}.zip.sha256',
  )
  expect(signingStep('Compute checksum').run).not.toContain('>>')
})

test('cleans up imported certificates even after a failed signing step', () => {
  const cleanup = signingStep('Clean up signing keychain')
  expect(cleanup.if).toBe('${{ always() && !inputs.adhoc }}')
  expect(cleanup.with?.['mode']).toBe('cleanup')
  expect(signingStep('Import codesign certificate').id).toBe('import-signing')
  expect(cleanup.with?.['temporary-directory']).toBe(
    '${{ steps.import-signing.outputs.temporary-directory }}',
  )
  const credentials = signingStep('Import codesign certificate')
  const notarize = signingStep('Notarize, staple, and package application')
  expect(credentials.with?.['apple-id']).toBe('${{ vars.APPLE_ID }}')
  expect(credentials.with?.['app-specific-password']).toBe(
    '${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}',
  )
  expect(credentials.with?.['team-id']).toBe('${{ vars.APPLE_TEAM_ID }}')
  expect(notarize.env?.['SOCKEYE_SIGNING_KEYCHAIN']).toBeUndefined()
  expect(notarize.run).toContain(
    '--keychain "${{ steps.import-signing.outputs.notary-keychain }}"',
  )
  expect(job.steps.at(-1)).toBe(cleanup)
})

test('publishes one tag release after both signed artifacts verify', () => {
  expect(releaseJob.needs).toBe('build-sign')
  expect(releaseJob.if).toBe(
    "${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') }}",
  )
  expect(releaseJob.permissions).toEqual({ contents: 'read' })
  expect(releaseStep('Download signed artifacts').with).toEqual({
    path: 'release-assets',
  })
  for (const [arch, label] of [
    ['arm64', 'ARM64'],
    ['x64', 'x64'],
  ]) {
    const verification = releaseStep(`Verify ${label} release artifact`)
    expect(verification.run).toContain(`--expected-version "\${RELEASE_TAG#v}"`)
    expect(verification.run).toContain(`--expected-architecture ${arch}`)
    expect(verification.run).toContain(
      `--receipt release-assets/sockeye-darwin-${arch}/sockeye-darwin-${arch}.zip.notary-receipt.json`,
    )
    expect(verification.run).toContain(
      `--submission release-assets/sockeye-darwin-${arch}/sockeye-darwin-${arch}.zip.notary-submission.zip`,
    )
    expect(verification.run).toContain(
      `--notary-log release-assets/sockeye-darwin-${arch}/sockeye-darwin-${arch}.zip.notary-log.json`,
    )
    expect(verification.env?.['RELEASE_TAG']).toBe('${{ github.ref_name }}')
    expect(verification.env?.['SOURCE_SHA']).toBe('${{ github.sha }}')
    expect(verification.env?.['RUN_ID']).toBe('${{ github.run_id }}')
    expect(verification.env?.['RUN_ATTEMPT']).toBe('${{ github.run_attempt }}')
    expect(verification.env?.['REPOSITORY']).toBe('${{ github.repository }}')
    expect(verification.env?.['WORKFLOW_REF']).toBe(
      '${{ github.workflow_ref }}',
    )
  }
  const release = releaseStep('Cut immutable GitHub release')
  expect(release.with?.['tag']).toBe('${{ github.ref_name }}')
  expect(release.with?.['dry-run']).toBe('false')
  expect(release.with?.['assets']).toBe(
    [
      'release-assets/sockeye-darwin-arm64/sockeye-darwin-arm64.zip',
      'release-assets/sockeye-darwin-arm64/sockeye-darwin-arm64.zip.sha256',
      'release-assets/sockeye-darwin-arm64/sockeye-darwin-arm64.zip.notary-receipt.json',
      'release-assets/sockeye-darwin-x64/sockeye-darwin-x64.zip',
      'release-assets/sockeye-darwin-x64/sockeye-darwin-x64.zip.sha256',
      'release-assets/sockeye-darwin-x64/sockeye-darwin-x64.zip.notary-receipt.json',
    ].join('\n') + '\n',
  )
  expect(release.with?.['token']).toBe('${{ steps.release-app.outputs.token }}')
})

test('reads public Apple identity from variables', () => {
  const credentials = signingStep('Import codesign certificate')
  expect(credentials.with?.['apple-id']).toBe('${{ vars.APPLE_ID }}')
  expect(credentials.with?.['team-id']).toBe('${{ vars.APPLE_TEAM_ID }}')
  expect(credentials.with?.['app-specific-password']).toBe(
    '${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}',
  )
})
