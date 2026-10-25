import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  parseFlags,
  readJson,
  runPipeline,
  runStage,
} from '../lib/build-pipeline.mts'

const io = vi.hoisted(() => ({ shouldRun: vi.fn(), create: vi.fn() }))
vi.mock(import('../lib/checkpoint-manager.mts'), async original => ({
  ...(await original()),
  shouldRun: io.shouldRun,
  createCheckpoint: io.create,
  cleanCheckpoint: vi.fn(),
}))
let root: string
beforeEach(() => {
  vi.clearAllMocks()
  io.shouldRun.mockResolvedValue(true)
  io.create.mockResolvedValue(undefined)
  root = mkdtempSync(path.join(os.tmpdir(), 'sockeye-pipeline-operations-'))
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '1.2.3' }),
  )
})
afterEach(async () => {
  vi.restoreAllMocks()
  await safeDelete(root)
})
function context() {
  return {
    buildMode: 'prod',
    forceRebuild: true,
    logger: { step: vi.fn(), substep: vi.fn() },
    packageRoot: root,
    paths: { buildDir: root },
    sharedPaths: { buildDir: path.join(root, 'shared') },
    platformArch: 'linux-arm64-musl',
    nodeVersion: '24.0.0',
  }
}
test('target metadata and zero binary size survive checkpoint creation', async () => {
  const ctx = context()
  const smokeTest = vi.fn()
  const run = vi.fn().mockResolvedValue({
    artifactPath: '/example/archive',
    binaryPath: '/example/binary',
    binarySize: 0,
    smokeTest,
  })
  const params = { release: true }
  await runStage(
    { name: 'binary-released', run, sourcePaths: [path.join(root, 'missing')] },
    ctx,
    params,
  )
  expect(run).toHaveBeenCalledWith(ctx, params)
  expect(io.shouldRun).toHaveBeenCalledWith(
    root,
    '',
    'binary-released',
    expect.objectContaining({
      platform: 'linux',
      arch: 'arm64',
      libc: 'musl',
      force: true,
    }),
  )
  expect(io.create).toHaveBeenCalledWith(
    root,
    'binary-released',
    smokeTest,
    expect.objectContaining({
      binarySize: 0,
      artifactPath: '/example/archive',
      binaryPath: '/example/binary',
      nodeVersion: '24.0.0',
      sourcePaths: [path.join(root, 'package.json')],
    }),
  )
})
test('shared stages omit target metadata and use the shared checkpoint directory', async () => {
  const ctx = context()
  await runStage({ name: 'source-copied', shared: true, run: vi.fn() }, ctx, {})
  expect(io.shouldRun).toHaveBeenCalledWith(
    ctx.sharedPaths.buildDir,
    '',
    'source-copied',
    { force: true, sourcePaths: [path.join(root, 'package.json')] },
  )
  expect(io.create.mock.calls[0]?.[3]).not.toHaveProperty('platform')
  await io.create.mock.calls[0]?.[2]()
})
test('development-only skip and cache hit execute no stage or checkpoint writes', async () => {
  const ctx = context()
  const run = vi.fn()
  await runStage(
    { name: 'source-copied', skipInDev: true, run },
    { ...ctx, buildMode: 'dev' },
    {},
  )
  expect(io.shouldRun).not.toHaveBeenCalled()
  io.shouldRun.mockResolvedValue(false)
  await runStage({ name: 'source-copied', run }, ctx, {})
  expect(run).not.toHaveBeenCalled()
  expect(io.create).not.toHaveBeenCalled()
})
test('stage rejection never creates a success checkpoint', async () => {
  const failure = new Error('stage failed')
  await expect(
    runStage(
      { name: 'source-copied', run: vi.fn().mockRejectedValue(failure) },
      context(),
      {},
    ),
  ).rejects.toBe(failure)
  expect(io.create).not.toHaveBeenCalled()
})
test('cache-key-only mode does not acquire paths or execute preflight', async () => {
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const getBuildPaths = vi.fn()
  const preflight = vi.fn()
  const run = vi.fn()
  await runPipeline(
    {
      packageRoot: root,
      packageName: 'example-builder',
      getBuildPaths,
      preflight,
      stages: [{ name: 'source-copied', run }],
    },
    parseFlags(['--cache-key']),
  )
  expect(output).toHaveBeenCalledOnce()
  expect(getBuildPaths).not.toHaveBeenCalled()
  expect(preflight).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
})
test('JSON loading distinguishes missing files from corrupt input', async () => {
  expect(await readJson(path.join(root, 'missing.json'))).toBeUndefined()
  const file = path.join(root, 'invalid.json')
  writeFileSync(file, '{')
  await expect(readJson(file)).rejects.toBeInstanceOf(Error)
  await expect(readJson(root)).rejects.toBeInstanceOf(Error)
})
