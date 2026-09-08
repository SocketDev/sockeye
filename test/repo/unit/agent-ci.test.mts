import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
  agentCiFiles,
  resolveAgentCiWorkflow,
} from '../../../scripts/repo/agent-ci.mts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

async function repository(): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'sockeye-local-ci-')),
  )
  roots.push(root)
  await mkdir(path.join(root, '.github/workflows'), { recursive: true })
  await writeFile(path.join(root, '.github/workflows/ci.yml'), 'name: example')
  return root
}

test('resolves only a regular workflow within the explicitly selected repository', async () => {
  const root = await repository()
  const workflow = resolveAgentCiWorkflow(root, '.github/workflows/ci.yml')
  expect(workflow).toContain('.github/workflows/ci.yml')
  for (const filename of [
    '../outside.yml',
    '.github/elsewhere.yml',
    '.github/workflows/example.lock.yml',
    '.github/workflows',
  ]) {
    expect(() => resolveAgentCiWorkflow(root, filename)).toThrow()
  }
})

test('rejects workflow and parent symlinks and ambient Local CI environment files', async () => {
  const root = await repository()
  const external = await repository()
  await symlink(
    path.join(external, '.github/workflows/ci.yml'),
    path.join(root, '.github/workflows/link.yml'),
  )
  expect(() =>
    resolveAgentCiWorkflow(root, '.github/workflows/link.yml'),
  ).toThrow()
  await symlink(
    path.join(external, '.github/workflows'),
    path.join(root, '.github/workflows/linked'),
  )
  expect(() =>
    resolveAgentCiWorkflow(root, '.github/workflows/linked/ci.yml'),
  ).toThrow()
  await writeFile(path.join(root, '.env.local-ci'), '')
  expect(() =>
    resolveAgentCiWorkflow(root, '.github/workflows/ci.yml'),
  ).toThrow()
})

test('resolves the target repository current Local CI package and binds its JavaScript payload', async () => {
  const root = await repository()
  const packageRoot = path.join(root, 'node_modules/run-local-ci')
  await mkdir(path.join(packageRoot, 'dist/commands'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), '{"private":true}')
  await writeFile(
    path.join(packageRoot, 'package.json'),
    '{"name":"run-local-ci","version":"0.18.1"}',
  )
  await writeFile(path.join(packageRoot, 'dist/cli.js'), '')
  await writeFile(path.join(packageRoot, 'dist/commands/run.js'), '')
  const result = agentCiFiles(root)
  expect(result.entry).toBe(path.join(packageRoot, 'dist/cli.js'))
  expect(result.files).toEqual(
    expect.arrayContaining([
      path.join(packageRoot, 'package.json'),
      result.entry,
      path.join(packageRoot, 'dist/commands/run.js'),
    ]),
  )
})
