import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  buildCacheKey,
  hashFileContents,
  loadPackageJson,
  parseFlags,
  runPipeline,
  runPipelineCli,
} from '../lib/build-pipeline.mts'
const io = vi.hoisted(() => ({ shouldRun: vi.fn(), create: vi.fn() }))
vi.mock(import('../lib/checkpoint-manager.mts'), async original => ({
  ...(await original()),
  shouldRun: io.shouldRun,
  createCheckpoint: io.create,
  cleanCheckpoint: vi.fn(),
}))
let root: string
const originalArgv = process.argv
const originalExitCode = process.exitCode
beforeEach(() => {
  vi.clearAllMocks()
  io.shouldRun.mockResolvedValue(true)
  io.create.mockResolvedValue(undefined)
  root = mkdtempSync(path.join(os.tmpdir(), 'pipeline-cache-inputs-'))
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '1.0.0' }),
  )
  process.argv = ['node', '/example/build.mts']
})
afterEach(async () => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
  await safeDelete(root)
})
test('hashes sorted file names and bytes including absent and unreadable entries', () => {
  const first = path.join(root, 'first.txt')
  const second = path.join(root, 'second.txt')
  const missing = path.join(root, 'missing.txt')
  writeFileSync(first, 'first')
  writeFileSync(second, 'second')
  const digest = hashFileContents([first, second, missing, root])
  expect(hashFileContents([root, missing, second, first])).toBe(digest)
  writeFileSync(first, 'changed')
  expect(hashFileContents([first, second, missing, root])).not.toBe(digest)
  expect(hashFileContents([first])).not.toBe(hashFileContents([second]))
})
test('cache identity is order independent and invalidates changed source or extra inputs', () => {
  const config = {
    buildMode: 'prod',
    nodeVersion: '24.0.0',
    platformArch: 'linux-x64',
    packageVersion: '1.0.0',
    toolsHash: 'example-tools',
    toolVersions: { ninja: '1.0.0', cmake: '2.0.0' },
    sources: {
      secondary: {},
      primary: {
        version: '3.0.0',
        ref: 'example-ref',
        url: 'https://example.invalid/source',
      },
    },
    extraHash: 'example-extra',
  }
  const expected = buildCacheKey(config)
  expect(
    buildCacheKey({
      ...config,
      toolVersions: { cmake: '2.0.0', ninja: '1.0.0' },
      sources: { primary: config.sources.primary, secondary: {} },
    }),
  ).toBe(expected)
  expect(buildCacheKey({ ...config, extraHash: 'changed-extra' })).not.toBe(
    expected,
  )
  expect(
    buildCacheKey({
      ...config,
      sources: {
        ...config.sources,
        primary: { ...config.sources.primary, ref: 'changed-ref' },
      },
    }),
  ).not.toBe(expected)
})
test('missing package metadata rejects the build', async () => {
  await expect(loadPackageJson(path.join(root, 'missing'))).rejects.toThrow()
})
test('starts at the requested stage after preflight and incorporates extra source bytes', async () => {
  const first = vi.fn()
  const second = vi.fn()
  const preflight = vi.fn()
  const extra = path.join(root, 'extra.txt')
  writeFileSync(extra, 'extra build input')
  const result = await runPipeline(
    {
      packageRoot: root,
      packageName: 'example-builder',
      extraCacheInputs: [extra],
      getBuildPaths: () => ({ buildDir: root }),
      stages: [
        { name: 'source-copied', run: first },
        { name: 'binary-released', run: second },
      ],
      preflight,
    },
    parseFlags(['--from-stage=binary-released']),
  )
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledOnce()
  expect(preflight).toHaveBeenCalledOnce()
  expect(preflight.mock.invocationCallOrder[0]).toBeLessThan(
    second.mock.invocationCallOrder[0],
  )
  expect(result?.cacheKey).toContain('-1.0.0')
})
test('CLI rethrows invalid stage selection and sets a failure exit code', async () => {
  process.argv.push('--from-stage=example-unknown')
  const run = vi.fn()
  await expect(
    runPipelineCli({
      packageRoot: root,
      packageName: 'example-builder',
      getBuildPaths: () => ({ buildDir: root }),
      stages: [{ name: 'source-copied', run }],
    }),
  ).rejects.toThrow()
  expect(process.exitCode).toBe(1)
  expect(run).not.toHaveBeenCalled()
})
test('CLI executes a successful pipeline without changing its exit code', async () => {
  const run = vi.fn()
  process.exitCode = 0
  await runPipelineCli({
    packageRoot: root,
    packageName: 'example-builder',
    getBuildPaths: () => ({ buildDir: root }),
    stages: [{ name: 'source-copied', run }],
  })
  expect(run).toHaveBeenCalledOnce()
  expect(process.exitCode).toBe(0)
})
