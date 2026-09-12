import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, expect, test } from 'vitest'
import { parse } from 'yaml'

const action = parse(
  readFileSync(
    new URL(
      '../../../.github/actions/repo/import-codesign-certs/action.yml',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  runs: { using: string; steps: { run: string }[] }
}
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await safeDelete(root)
})

function keychainFixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sockeye-keychain-action-'))
  roots.push(root)
  return root
}

const mocks = `
openssl() { printf '%s' 'example-generated-keychain-password'; }
security() {
  local command="$1" target="\${!#}"
  printf '%s\\n' "$command" >> "$RUNNER_TEMP/commands"
  case "$command" in
    list-keychains)
      if [[ "\${4:-}" == -s ]]; then
        printf '%s\\0' "\${@:5}" > "$RUNNER_TEMP/current-search-list"
      else
        printf '    "%s"\\n' '/example/Login Keychain.keychain-db' '/example/Secondary.keychain-db'
      fi ;;
    create-keychain) touch "$target" ;;
    delete-keychain) rm -f "$target" ;;
  esac
  if [[ "$command" == "$SIGNING_FAILURE" ]]; then return 73; fi
}
`

function runKeychainAction(
  root: string,
  config: { mode: string; failure?: string; directory?: string },
) {
  return spawnSync(
    '/bin/bash',
    ['-c', `${mocks}\n${action.runs.steps[0]!.run}`],
    {
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin',
        RUNNER_TEMP: root,
        GITHUB_OUTPUT: path.join(root, 'github-output'),
        SIGNING_ACTION_MODE: config.mode,
        SIGNING_FAILURE: config.failure ?? '',
        SOCKEYE_SIGNING_TEMP_DIR: config.directory ?? '',
        P12_BASE64: Buffer.from('example-p12-bytes').toString('base64'),
        P12_PASSWORD: 'not-a-real-password',
      },
    },
  )
}

function recordedDirectory(root: string): string {
  const entry = readFileSync(path.join(root, 'github-output'), 'utf8')
    .trim()
    .split(/\r?\n/u)
    .filter(line => line.startsWith('temporary-directory='))
    .at(-1)!
  return entry.slice('temporary-directory='.length)
}

function searchList(root: string): string[] {
  return readFileSync(path.join(root, 'current-search-list'), 'utf8')
    .split('\0')
    .filter(Boolean)
}

const original = [
  '/example/Login Keychain.keychain-db',
  '/example/Secondary.keychain-db',
]

test('imports with a temporary keychain and restores the exact original list on cleanup', () => {
  const root = keychainFixture()
  expect(action.runs.using).toBe('composite')
  const result = runKeychainAction(root, { mode: 'import' })
  expect(result.status).toBe(0)
  const directory = recordedDirectory(root)
  expect(existsSync(path.join(directory, 'certificate.p12'))).toBe(false)
  expect(searchList(root)).toEqual([
    path.join(directory, 'signing.keychain-db'),
    ...original,
  ])
  expect(result.stdout).toContain(
    '::add-mask::example-generated-keychain-password',
  )
  expect(result.stdout).not.toContain('not-a-real-password')
  expect(runKeychainAction(root, { mode: 'cleanup', directory }).status).toBe(0)
  expect(searchList(root)).toEqual(original)
  expect(existsSync(directory)).toBe(false)
})

test.each(['create-keychain', 'import', 'set-key-partition-list'])(
  'restores the search list and deletes temporary material after %s failure',
  failure => {
    const root = keychainFixture()
    const result = runKeychainAction(root, { mode: 'import', failure })
    expect(result.status).toBe(73)
    expect(searchList(root)).toEqual(original)
    expect(
      readdirSync(root).filter(name => name.startsWith('sockeye-signing.')),
    ).toEqual([])
    expect(existsSync(path.join(root, 'github-output'))).toBe(false)
    expect(runKeychainAction(root, { mode: 'cleanup' }).status).toBe(0)
  },
)

test('cleanup without an imported keychain does not touch security', () => {
  const root = keychainFixture()
  expect(runKeychainAction(root, { mode: 'cleanup' }).status).toBe(0)
  expect(existsSync(path.join(root, 'commands'))).toBe(false)
})

test.each([
  'sockeye-signing.example/../../other',
  'sockeye-signing.ABC123/nested',
])('rejects non-owned cleanup paths before security calls: %s', suffix => {
  const root = keychainFixture()
  expect(
    runKeychainAction(root, { mode: 'cleanup', directory: `${root}/${suffix}` })
      .status,
  ).toBe(1)
  expect(existsSync(path.join(root, 'commands'))).toBe(false)
})

test('rejects symlink cleanup directories before following them', () => {
  const root = keychainFixture()
  const target = keychainFixture()
  const directory = path.join(root, 'sockeye-signing.ABC123')
  symlinkSync(target, directory)
  expect(runKeychainAction(root, { mode: 'cleanup', directory }).status).toBe(1)
  expect(existsSync(target)).toBe(true)
  expect(existsSync(path.join(root, 'commands'))).toBe(false)
})

test('refuses newline-bearing output paths before importing any credentials', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sockeye-keychain-output-\n'))
  roots.push(root)
  expect(runKeychainAction(root, { mode: 'import' }).status).toBe(1)
  expect(existsSync(path.join(root, 'commands'))).toBe(false)
  expect(existsSync(path.join(root, 'github-output'))).toBe(false)
})
