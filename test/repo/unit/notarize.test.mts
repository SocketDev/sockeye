import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { beforeEach, expect, test, vi } from 'vitest'

import {
  createNotaryArchive,
  inspectNotaryLog,
  notarySubmissionArgs,
  notarizeReleaseBundle,
  parseNotaryJson,
  parseNotaryReceipt,
  SCRIPT_META,
  submitNotaryArchive,
  waitForNotarySubmission,
} from '../../../scripts/repo/notarize.mts'
import {
  releaseNotaryEvidencePaths,
  releaseNotaryWorkingPaths,
} from '../../../scripts/repo/paths.mts'
import {
  completedNotaryReceiptIsValid,
  writeCompletedNotaryReceipt,
} from '../../../scripts/repo/release/notary-receipt.mts'

vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: vi.fn(),
  }),
)

vi.mock('../../../scripts/repo/release/bundle.mts', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../../scripts/repo/release/bundle.mts')
  >()),
  validateReleaseBundleMetadata: vi.fn(async () => {}),
}))

vi.mock(
  '../../../scripts/repo/release/notary-receipt.mts',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('../../../scripts/repo/release/notary-receipt.mts')
    >()),
    readReleaseBundleIdentity: vi.fn(async () => ({
      binarySha256: 'a'.repeat(64),
      certificateSha256: 'A'.repeat(64),
      profileSha256: 'b'.repeat(64),
      profileUuid: '87654321-4321-4321-4321-cba987654321',
    })),
    writeCompletedNotaryReceipt: vi.fn(async (filename: string) => {
      await fs.writeFile(filename, '{"status":"complete"}\n')
    }),
  }),
)

const submissionId = '12345678-1234-1234-1234-123456789abc'
const commandResult = {
  args: [],
  cmd: '/usr/bin/xcrun',
  code: 0,
  signal: null,
  stderr: '',
}

beforeEach(() => vi.resetAllMocks())

test('parses only notary JSON objects', () => {
  expect(parseNotaryJson('{"status":"Accepted"}', 'example')).toEqual({
    status: 'Accepted',
  })
  expect(() => parseNotaryJson('[]', 'example')).toThrow()
  expect(() => parseNotaryJson('invalid', 'example')).toThrow()
})

test('requires Accepted status and a submission ID', async () => {
  vi.mocked(spawn).mockResolvedValue({
    ...commandResult,
    stdout: JSON.stringify({ id: submissionId, status: 'Accepted' }),
  })
  await expect(
    submitNotaryArchive({ archive: 'example.zip', profile: 'example-notary' }),
  ).resolves.toBe(submissionId)
  expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([
    '/usr/bin/xcrun',
    notarySubmissionArgs({ archive: 'example.zip', profile: 'example-notary' }),
  ])
  expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({
    throws: false,
    timeout: 120_000,
  })
})

test.each([
  '{"status":"Accepted"}',
  '{"id":"12345678-1234-1234-1234-123456789abc","status":"Invalid"}',
  '{"status":"In Progress"}',
  '{}',
  'null',
  'not JSON',
])(
  'rejects incomplete or nonaccepted submission evidence: %s',
  async stdout => {
    vi.mocked(spawn).mockResolvedValue({ ...commandResult, stdout })
    await expect(
      submitNotaryArchive({
        archive: 'example.zip',
        profile: 'example-notary',
      }),
    ).rejects.toThrow()
  },
)

test('rejects command failure even with accepted evidence', async () => {
  vi.mocked(spawn).mockResolvedValue({
    ...commandResult,
    code: 1,
    stdout: JSON.stringify({ id: submissionId, status: 'Accepted' }),
  })
  await expect(
    submitNotaryArchive({ archive: 'example.zip', profile: 'example-notary' }),
  ).rejects.toThrow()
})

test('rejects error-severity log issues and accepts warnings', async () => {
  const digest = 'a'.repeat(64)
  vi.mocked(spawn).mockResolvedValueOnce({
    ...commandResult,
    stdout: JSON.stringify({
      issues: [{ severity: 'warning' }],
      jobId: submissionId,
      sha256: digest,
      status: 'Accepted',
    }),
  })
  await expect(
    inspectNotaryLog(submissionId, digest, { profile: 'example-notary' }),
  ).resolves.toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) })
  vi.mocked(spawn).mockResolvedValueOnce({
    ...commandResult,
    stdout: JSON.stringify({
      issues: [{ severity: 'error' }],
      jobId: submissionId,
      sha256: digest,
      status: 'Accepted',
    }),
  })
  await expect(
    inspectNotaryLog(submissionId, digest, { profile: 'example-notary' }),
  ).rejects.toThrow()
  vi.mocked(spawn).mockResolvedValueOnce({
    ...commandResult,
    stdout: JSON.stringify({
      issues: [{ severity: 'fatal' }],
      jobId: submissionId,
      sha256: digest,
      status: 'Accepted',
    }),
  })
  await expect(
    inspectNotaryLog(submissionId, digest, { profile: 'example-notary' }),
  ).rejects.toThrow()
  vi.mocked(spawn).mockResolvedValueOnce({
    ...commandResult,
    stdout: JSON.stringify({
      issues: ['invalid'],
      jobId: submissionId,
      sha256: digest,
      status: 'Accepted',
    }),
  })
  await expect(
    inspectNotaryLog(submissionId, digest, { profile: 'example-notary' }),
  ).rejects.toThrow()
  vi.mocked(spawn).mockResolvedValueOnce({
    ...commandResult,
    stdout: '{}',
  })
  await expect(
    inspectNotaryLog(submissionId, digest, { profile: 'example-notary' }),
  ).rejects.toThrow()
})

test('resumes one recorded submission without uploading again', async () => {
  vi.mocked(spawn).mockResolvedValue({
    ...commandResult,
    stdout: '{"status":"Accepted"}',
  })
  await waitForNotarySubmission(submissionId, { profile: 'example-notary' })
  expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([
    'notarytool',
    'wait',
    submissionId,
    '--keychain-profile',
    'example-notary',
    '--output-format',
    'json',
  ])
  expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({
    throws: false,
    timeout: 900_000,
  })
})

test('creates clean archives without resource forks or extended attributes', async () => {
  vi.mocked(spawn).mockResolvedValue({ ...commandResult, stdout: '' })
  await createNotaryArchive('/example/sockeye.app', '/example/release.zip')
  expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([
    '-c',
    '-k',
    '--norsrc',
    '--keepParent',
    '/example/sockeye.app',
    '/example/release.zip',
  ])
})

test('validates resume receipt identity and digest', () => {
  const identity = {
    binarySha256: 'a'.repeat(64),
    certificateSha256: 'A'.repeat(64),
    profileSha256: 'b'.repeat(64),
    profileUuid: '87654321-4321-4321-4321-cba987654321',
  }
  expect(
    parseNotaryReceipt({
      ...identity,
      submissionId,
      submissionSha256: 'a'.repeat(64),
    }),
  ).toEqual({ ...identity, submissionId, submissionSha256: 'a'.repeat(64) })
  expect(() =>
    parseNotaryReceipt({
      ...identity,
      submissionId,
      submissionSha256: 'short',
    }),
  ).toThrow()
  expect(() =>
    parseNotaryReceipt({
      ...identity,
      submissionId: '-'.repeat(36),
      submissionSha256: 'a'.repeat(64),
    }),
  ).toThrow()
})

test('binds completed receipts to the archive, source, and architecture', () => {
  const digest = 'a'.repeat(64)
  const imported = (value: string) => ({ source: 'imported', value })
  const measured = (value: string) => ({ source: 'measured', value })
  const value = {
    architecture: imported('arm64'),
    archiveSha256: measured(digest),
    assessmentResult: measured('accepted'),
    binarySha256: measured(digest),
    certificateSha256: measured('A'.repeat(64)),
    codesignResult: measured('passed'),
    completedAt: measured('2030-01-01T00:00:00.000Z'),
    githubRunAttempt: imported('1'),
    githubRunId: imported('123'),
    githubRepository: imported('SocketDev/sockeye'),
    githubWorkflowRef: imported(
      'SocketDev/sockeye/.github/workflows/release-sign-macos.yml@refs/tags/v1.2.3',
    ),
    logSha256: measured(digest),
    macosVersion: measured('14.5'),
    profileSha256: measured(digest),
    profileUuid: measured('87654321-4321-4321-4321-cba987654321'),
    sourceSha: imported('b'.repeat(40)),
    stapleResult: measured('validated'),
    status: 'complete',
    submissionId: measured(submissionId),
    submissionSha256: measured(digest),
  }
  const expected = {
    architecture: 'arm64',
    archiveSha256: digest,
    bundleIdentity: {
      binarySha256: digest,
      certificateSha256: 'A'.repeat(64),
      profileSha256: digest,
      profileUuid: '87654321-4321-4321-4321-cba987654321',
    },
    githubRunAttempt: '1',
    githubRunId: '123',
    githubRepository: 'SocketDev/sockeye',
    githubWorkflowRef:
      'SocketDev/sockeye/.github/workflows/release-sign-macos.yml@refs/tags/v1.2.3',
    logSha256: digest,
    sourceSha: 'b'.repeat(40),
    submissionSha256: digest,
  }
  expect(completedNotaryReceiptIsValid(value, expected)).toBe(true)
  expect(
    completedNotaryReceiptIsValid(
      { ...value, archiveSha256: measured('c'.repeat(64)) },
      expected,
    ),
  ).toBe(false)
})

test('describes the entrypoint before processing release targets', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      fileURLToPath(
        new URL('../../../scripts/repo/notarize.mts', import.meta.url),
      ),
      '--describe',
      '--json',
      '--run',
      '--bundle',
      'missing.app',
      '--output',
      'missing.zip',
    ],
    { encoding: 'utf8', timeout: 5000 },
  )
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout ?? '')).toMatchObject({
    description: SCRIPT_META.describe,
    name: 'notarize.mts',
  })
  expect(result.stderr).toBe('')
})

test('passes an explicit temporary keychain to notarytool', () => {
  expect(
    notarySubmissionArgs({
      archive: 'example.zip',
      profile: 'example-notary',
      keychain: '/example/temporary.keychain-db',
    }),
  ).toContain('/example/temporary.keychain-db')
})

function mockNotaryPipeline(submission: string): void {
  const digest = crypto.hash('sha256', 'fictional archive')
  vi.mocked(spawn).mockImplementation((async (cmd, args = []) => {
    let stdout = ''
    if (cmd === '/usr/bin/ditto' && args[0] === '-c') {
      await fs.writeFile(args.at(-1)!, 'fictional archive')
    } else if (cmd === '/usr/bin/ditto' && args[0] === '-x') {
      await fs.mkdir(path.join(args.at(-1)!, 'sockeye.app'), {
        recursive: true,
      })
    } else if (args[0] === 'notarytool' && args[1] === 'submit') {
      stdout = submission
    } else if (args[0] === 'notarytool' && args[1] === 'log') {
      stdout = JSON.stringify({
        issues: [],
        jobId: submissionId,
        sha256: digest,
        status: 'Accepted',
      })
    } else if (args[0] === 'notarytool' && args[1] === 'wait') {
      stdout = '{"status":"Accepted"}'
    }
    return { ...commandResult, args, cmd, stdout }
  }) as typeof spawn)
}

function notarizationCallLabel(cmd: string, args: readonly string[]): string {
  if (cmd === '/usr/bin/ditto') {
    return args.at(-1)?.includes('notary-submission') === true
      ? 'submission-archive'
      : 'final-archive'
  }
  if (cmd === 'pnpm') {
    return 'verify'
  }
  if (args[0] === 'stapler' && args[1] === 'validate') {
    return 'staple-validate'
  }
  return args[1] ?? args[0] ?? cmd
}

test('runs notarization phases in fail-closed order', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'notary-test-'))
  try {
    const bundle = path.join(scratch, 'sockeye.app')
    const output = path.join(scratch, 'release.zip')
    await fs.mkdir(bundle)
    mockNotaryPipeline(JSON.stringify({ id: submissionId }))
    await notarizeReleaseBundle(bundle, output, 'example-notary')
    expect(
      vi
        .mocked(spawn)
        .mock.calls.map(([cmd, args = []]) => notarizationCallLabel(cmd, args)),
    ).toEqual([
      '--deep',
      'submission-archive',
      'submit',
      'wait',
      'log',
      'staple',
      'staple-validate',
      'final-archive',
      'verify',
    ])
    await expect(fs.stat(output)).resolves.toBeDefined()
  } finally {
    await fs.rm(scratch, { force: true, recursive: true })
  }
})

test.each([
  'wait',
  'log',
  'staple',
  'staple-validate',
  'final-archive',
  'verify',
])('does not expose final output when %s fails', async failedPhase => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'notary-test-'))
  try {
    const bundle = path.join(scratch, 'sockeye.app')
    const output = path.join(scratch, 'release.zip')
    await fs.mkdir(bundle)
    mockNotaryPipeline(JSON.stringify({ id: submissionId }))
    const pipeline = vi.mocked(spawn).getMockImplementation()!
    vi.mocked(spawn).mockImplementation((async (cmd, args = []) => {
      const result = await pipeline(cmd, args)
      return notarizationCallLabel(cmd, args) === failedPhase
        ? { ...result, code: 1 }
        : result
    }) as typeof spawn)
    await expect(
      notarizeReleaseBundle(bundle, output, 'example-notary'),
    ).rejects.toThrow()
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await fs.rm(scratch, { force: true, recursive: true })
  }
})

test('removes final output when completed receipt creation fails', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'notary-test-'))
  try {
    const bundle = path.join(scratch, 'sockeye.app')
    const output = path.join(scratch, 'release.zip')
    await fs.mkdir(bundle)
    mockNotaryPipeline(JSON.stringify({ id: submissionId }))
    vi.mocked(writeCompletedNotaryReceipt).mockRejectedValueOnce(
      new Error('receipt failed'),
    )
    await expect(
      notarizeReleaseBundle(bundle, output, 'example-notary'),
    ).rejects.toThrow('receipt failed')
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await fs.rm(scratch, { force: true, recursive: true })
  }
})

test('does not expose output when the atomic rename fails', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'notary-test-'))
  try {
    const bundle = path.join(scratch, 'sockeye.app')
    const output = path.join(scratch, 'release.zip')
    await fs.mkdir(bundle)
    mockNotaryPipeline(JSON.stringify({ id: submissionId }))
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'))
    await expect(
      notarizeReleaseBundle(bundle, output, 'example-notary'),
    ).rejects.toThrow('rename failed')
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    vi.restoreAllMocks()
    await fs.rm(scratch, { force: true, recursive: true })
  }
})

test('writes an unresolved receipt and stops after a response without an ID', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'notary-test-'))
  try {
    const bundle = path.join(scratch, 'sockeye.app')
    const output = path.join(scratch, 'release.zip')
    await fs.mkdir(bundle)
    mockNotaryPipeline('not JSON')
    await expect(
      notarizeReleaseBundle(bundle, output, 'example-notary'),
    ).rejects.toThrow()
    const unresolved = releaseNotaryWorkingPaths(output, 'unused').unresolved
    const receipt = JSON.parse(await fs.readFile(unresolved, 'utf8'))
    expect(receipt).toMatchObject({ status: 'unresolved' })
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(
      vi.mocked(spawn).mock.calls.some(call => call[1]?.[1] === 'staple'),
    ).toBe(false)
    const submissions = () =>
      vi.mocked(spawn).mock.calls.filter(call => call[1]?.[1] === 'submit')
        .length
    expect(submissions()).toBe(1)
    await expect(
      notarizeReleaseBundle(bundle, output, 'example-notary'),
    ).rejects.toThrow('could duplicate')
    expect(submissions()).toBe(1)
  } finally {
    await fs.rm(scratch, { force: true, recursive: true })
  }
})

test('resumes the recorded archive without another submission', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'notary-test-'))
  try {
    const bundle = path.join(scratch, 'sockeye.app')
    const output = path.join(scratch, 'release.zip')
    const receipt = path.join(scratch, 'receipt.json')
    await fs.mkdir(bundle)
    const submissionSha256 = crypto.hash('sha256', 'fictional archive')
    await fs.writeFile(
      receipt,
      JSON.stringify({
        binarySha256: 'a'.repeat(64),
        certificateSha256: 'A'.repeat(64),
        profileSha256: 'b'.repeat(64),
        profileUuid: '87654321-4321-4321-4321-cba987654321',
        submissionId,
        submissionSha256,
      }),
    )
    await fs.writeFile(
      releaseNotaryEvidencePaths(output).submission,
      'fictional archive',
    )
    mockNotaryPipeline('unexpected submit')
    await notarizeReleaseBundle(bundle, output, 'example-notary', {
      resume: receipt,
    })
    expect(await fs.readFile(output, 'utf8')).toBe('fictional archive')
    expect(
      vi.mocked(spawn).mock.calls.filter(call => call[1]?.[1] === 'submit'),
    ).toHaveLength(0)
    expect(
      vi.mocked(spawn).mock.calls.filter(call => call[1]?.[1] === 'wait'),
    ).toHaveLength(1)
    expect(writeCompletedNotaryReceipt).toHaveBeenCalledOnce()
  } finally {
    await fs.rm(scratch, { force: true, recursive: true })
  }
})
