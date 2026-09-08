import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, expect, test, vi } from 'vitest'

import {
  loadExternalTools,
  parseFlags,
  runPipeline,
} from '../lib/build-pipeline.mts'
import {
  getBuildRequirementsPath,
  getPackageManifestPath,
} from '../lib/paths.mts'
import { cleanCheckpoint } from '../lib/checkpoint-manager.mts'
import {
  getCheckpointArchiveFile,
  getCheckpointDirectory,
  getCheckpointFile,
  getCheckpointLockPath,
} from '../lib/checkpoint/paths.mts'

vi.mock(import('../lib/checkpoint-manager.mts'), async importOriginal => ({
  ...(await importOriginal()),
  cleanCheckpoint: vi.fn(async () => undefined),
  shouldRun: vi.fn(async () => false),
}))

const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  const removedRoots = roots.splice(0)
  for (let i = 0, { length } = removedRoots; i < length; i += 1) {
    await safeDelete(removedRoots[i]!)
  }
})

async function pipelineFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-pipeline-'))
  roots.push(root)
  await writeFile(
    getPackageManifestPath(root),
    JSON.stringify({ version: '1.0.0' }),
  )
  return {
    packageRoot: root,
    packageName: 'example-builder',
    stages: [{ name: 'source-copied', run: async () => undefined }],
    getBuildPaths: () => ({ buildDir: root }),
    getSharedBuildPaths: () => ({ buildDir: path.join(root, 'shared') }),
  }
}

test('hashes changed requirement bytes for pipeline invalidation', async () => {
  const config = await pipelineFixture()
  const file = getBuildRequirementsPath(config.packageRoot)
  await writeFile(
    file,
    JSON.stringify({ tools: { cmake: { version: '3.30.0' } } }),
  )
  const before = await loadExternalTools(config.packageRoot)
  await writeFile(
    file,
    JSON.stringify({ tools: { cmake: { version: '3.31.0' } } }),
  )
  const after = await loadExternalTools(config.packageRoot)
  expect(before.versions).toEqual({ cmake: '3.30.0' })
  expect(after.versions).toEqual({ cmake: '3.31.0' })
  expect(after.rawHash).not.toBe(before.rawHash)
})

test('cleans both platform and shared checkpoints on explicit clean', async () => {
  const config = await pipelineFixture()
  const ctx = await runPipeline(config, parseFlags(['--clean']))
  expect(cleanCheckpoint).toHaveBeenCalledWith(ctx?.paths.buildDir, '')
  expect(cleanCheckpoint).toHaveBeenCalledWith(ctx?.sharedPaths?.buildDir, '')
  expect(cleanCheckpoint).toHaveBeenCalledTimes(2)
})

test.each(['--clean-stage=missing', '--from-stage=missing'])(
  'rejects unknown checkpoint selection %s',
  async flag => {
    const config = await pipelineFixture()
    await expect(runPipeline(config, parseFlags([flag]))).rejects.toThrow()
  },
)

test('invalidates checkpoints when required output is absent', async () => {
  const config = await pipelineFixture()
  const getOutputFiles = () => [path.join(config.packageRoot, 'missing-output')]
  await runPipeline({ ...config, getOutputFiles }, parseFlags([]))
  expect(cleanCheckpoint).toHaveBeenCalledTimes(2)
})

test('cleans the requested stage while retaining earlier checkpoints', async () => {
  const config = await pipelineFixture()
  config.stages.push({ name: 'source-patched', run: async () => undefined })
  const directory = getCheckpointDirectory(config.packageRoot, '')
  await mkdir(directory)
  const earlier = getCheckpointFile(directory, 'source-copied')
  const metadata = getCheckpointFile(directory, 'source-patched')
  const archive = getCheckpointArchiveFile(directory, 'source-patched')
  const lock = getCheckpointLockPath(archive)
  const files = [earlier, metadata, archive, lock]
  await Promise.all(files.map(file => writeFile(file, 'fixture')))
  await runPipeline(config, parseFlags(['--clean-stage=source-patched']))
  expect(files.map(file => existsSync(file))).toEqual([
    true,
    false,
    false,
    false,
  ])
  expect(cleanCheckpoint).not.toHaveBeenCalled()
})
