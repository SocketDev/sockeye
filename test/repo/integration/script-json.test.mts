import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const entries = [
  'agent-ci',
  'build',
  'fuzz',
  'notarize',
  'optimize-svg',
  'preflight',
  'setup-credential',
  'setup-sockeye',
  'sign',
  'test-keychain-interactive',
  'test',
  'verify-release',
]

function probeEntry(name: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      fileURLToPath(
        new URL(`../../../scripts/repo/${name}.mts`, import.meta.url),
      ),
      ...args,
    ],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

for (const entry of entries) {
  test(`${entry} describes itself as JSON without child processes or writes`, () => {
    const result = probeEntry(entry, ['--describe', '--json', '--run'])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ name: `${entry}.mts` })
    expect(result.stderr).toBe('')
  })

  test(`${entry} reports rejected execution in one JSON envelope`, () => {
    const result = probeEntry(entry, ['--json', '--', '--run'])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 1 })
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
    expect(result.stderr).toBe('')
  })
}

test('credential JSON execution keeps the attended terminal requirement', () => {
  const result = probeEntry('setup-credential', [
    '--json',
    'EXAMPLE_CREDENTIAL',
  ])
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 1 })
  expect(result.stderr).toBe('')
})

test('signing JSON dry run leaves progress on stderr and returns one result', () => {
  const result = probeEntry('sign', ['--json', 'example-binary'])
  expect(result.error).toBeUndefined()
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: process.platform === 'darwin',
    exitCode: process.platform === 'darwin' ? 0 : 1,
  })
  expect(result.stdout.trim().split('\n')).toHaveLength(1)
  if (process.platform === 'darwin') {
    expect(result.stderr.length).toBeGreaterThan(0)
  }
})
