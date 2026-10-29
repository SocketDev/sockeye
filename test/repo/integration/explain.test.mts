import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, expect, test } from 'vitest'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  getBinaryPath,
  getBuildMode,
  getNativeTestBinaryPath,
} from '../../../scripts/repo/paths.mts'

const fixtures: string[] = []
const production = getBinaryPath(
  getBuildMode(),
  `${process.platform}-${process.arch}`,
)
const isolated = getNativeTestBinaryPath('sockeye-preview-isolation-test')
const binding = 'a'.repeat(64)

function makeExplainFixture(): {
  root: string
  marker: string
  args: string[]
  bound: string
} {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sockeye-explain-'))
  fixtures.push(root)
  const child = path.join(root, 'example-tool')
  const marker = path.join(root, 'started')
  const bound = path.join(root, 'example-config')
  writeFileSync(child, `#!/bin/sh\n/usr/bin/touch '${marker}'\n`)
  chmodSync(child, 0o700)
  writeFileSync(bound, 'configuration one\n')
  return {
    root,
    marker,
    bound,
    args: [
      '--credential',
      'EXAMPLE_TOKEN',
      '--binding',
      binding,
      '--pass-env',
      'EXAMPLE_CONFIG',
      '--bind-file',
      bound,
      '--cwd',
      root,
      '--',
      child,
      'line\nbreak',
      'quoted"argument',
    ],
  }
}

function runExplain(binary: string, command: string, args: string[]) {
  return spawnSync(binary, [command, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, EXAMPLE_CONFIG: 'fake-parent-value-hidden' },
  })
}

afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true })
})

test.each([production, isolated])(
  'previews without effects or parent values (%s)',
  binary => {
    const fixture = makeExplainFixture()
    const result = runExplain(binary, 'explain', fixture.args)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Request preview (no authorization)')
    expect(result.stdout).toMatch(/request ID: sha256:[a-f0-9]{64}\n/u)
    expect(result.stdout).toContain(`cwd: ${realpathSync(fixture.root)}`)
    expect(result.stdout).toContain('credential: EXAMPLE_TOKEN')
    expect(result.stdout).not.toContain('executable sha256:')
    expect(result.stdout).toContain('pass parent env: EXAMPLE_CONFIG')
    expect(result.stdout).toContain('"line\\x0abreak"')
    expect(result.stdout).toContain('"quoted\\"argument"')
    expect(result.stdout).toContain('arguments: [\n')
    expect(result.stdout).not.toContain('fake-parent-value-hidden')
    expect(existsSync(fixture.marker)).toBe(false)
  },
)

test('run preparation is fresh and the forbidden authorization detector is active', () => {
  const fixture = makeExplainFixture()
  const first = runExplain(isolated, 'explain', fixture.args)
  writeFileSync(fixture.bound, 'configuration two\n')
  const second = runExplain(isolated, 'explain', fixture.args)
  const firstDigest = first.stdout.match(
    /request ID: sha256:([a-f0-9]{64})/u,
  )?.[1]
  const secondDigest = second.stdout.match(
    /request ID: sha256:([a-f0-9]{64})/u,
  )?.[1]
  expect(firstDigest).toHaveLength(64)
  expect(secondDigest).toHaveLength(64)
  expect(secondDigest).not.toBe(firstDigest)
  const run = runExplain(isolated, 'run', fixture.args)
  expect(run.status).toBe(90)
  expect(run.stderr).toContain(`request ID: sha256:${secondDigest?.slice(0, 16)}`)
  expect(existsSync(fixture.marker)).toBe(false)
})

test.each(
  [
    [],
    ['--credential', 'bad-name', '--binding', binding],
    [
      '--credential',
      'EXAMPLE_TOKEN',
      '--binding',
      binding,
      '--credential',
      'EXAMPLE_TOKEN',
      '--binding',
      binding,
    ],
    ['--unexpected', 'value'],
  ].map(args => ({ args })),
)('rejects invalid preview arguments before effects: $args', ({ args }) => {
  const result = runExplain(isolated, 'explain', args)
  expect(result.status).toBe(2)
  expect(result.stdout).toBe('')
})

test('enforces argument bounds and normalized duplicate file rejection', () => {
  const fixture = makeExplainFixture()
  const atLimit = runExplain(isolated, 'explain', [
    ...fixture.args,
    'x'.repeat(4096),
  ])
  expect(atLimit.status).toBe(0)
  const oversized = runExplain(isolated, 'explain', [
    ...fixture.args,
    'x'.repeat(4097),
  ])
  expect(oversized.status).toBe(2)
  const duplicate = runExplain(isolated, 'explain', [
    '--bind-file',
    `${fixture.root}/./example-config`,
    ...fixture.args,
  ])
  expect(duplicate.status).toBe(2)
  expect(duplicate.stdout).toBe('')
})

test('rejects a display-control working directory reached through a clean symlink', () => {
  const fixture = makeExplainFixture()
  const target = path.join(fixture.root, 'unsafe\ncwd')
  const alias = path.join(fixture.root, 'safe-cwd')
  mkdirSync(target)
  symlinkSync(target, alias)
  const args = [...fixture.args]
  args[args.indexOf('--cwd') + 1] = alias
  const result = runExplain(isolated, 'explain', args)
  expect(result.status).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr).not.toContain(target)
})

test('rejects a display-control bound file reached through a clean symlink', () => {
  const fixture = makeExplainFixture()
  const target = path.join(fixture.root, 'unsafe\nbound-file')
  const alias = path.join(fixture.root, 'safe-bound-file')
  writeFileSync(target, 'example configuration', { mode: 0o600 })
  symlinkSync(target, alias)
  const args = [...fixture.args]
  args.splice(args.indexOf('--'), 0, '--bind-file', alias)
  const result = runExplain(isolated, 'explain', args)
  expect(result.status).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr).not.toContain(target)
})
