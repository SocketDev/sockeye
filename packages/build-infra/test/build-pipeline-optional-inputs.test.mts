import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  cleanPipelineCheckpoints,
  loadExternalTools,
  runPipeline,
} from '../lib/build-pipeline.mts'
const io = vi.hoisted(() => ({
  clean: vi.fn(),
  shouldRun: vi.fn(),
  create: vi.fn(),
}))
vi.mock(import('../lib/checkpoint-manager.mts'), async original => ({
  ...(await original()),
  cleanCheckpoint: io.clean,
  shouldRun: io.shouldRun,
  createCheckpoint: io.create,
}))
let root: string
beforeEach(() => {
  vi.resetAllMocks()
  root = mkdtempSync(path.join(os.tmpdir(), 'pipeline-optional-'))
  io.shouldRun.mockResolvedValue(true)
})
afterEach(async () => {
  await safeDelete(root)
})

test.each([
  {},
  {
    tools: {
      'example-tool': { description: 'example unversioned requirement' },
    },
  },
])(
  'valid optional requirement metadata yields its version map: %j',
  async requirements => {
    writeFileSync(
      path.join(root, 'build-requirements.json'),
      JSON.stringify(requirements),
    )
    const result = await loadExternalTools(root)
    expect(result.versions).toEqual(
      'tools' in requirements ? { 'example-tool': '' } : {},
    )
    expect(result.rawHash).toMatch(/^[a-f0-9]{16}$/u)
  },
)

test.each(['clean', 'missing-output', 'absent-markers'])(
  'checkpoint invalidation tolerates absent shared state: %s',
  async scenario => {
    const flags = {
      clean: scenario === 'clean',
      cleanStage: scenario === 'absent-markers' ? 'source-copied' : undefined,
    }
    const paths = { buildDir: root }
    await cleanPipelineCheckpoints({
      flags,
      paths,
      sharedPaths: undefined,
      stages: [{ name: 'source-copied' }],
      ctx: { paths },
      outputFiles:
        scenario === 'missing-output'
          ? [path.join(root, 'missing-output')]
          : [],
    })
    if (scenario === 'absent-markers') {
      expect(io.clean).not.toHaveBeenCalled()
    } else {
      expect(io.clean).toHaveBeenCalledExactlyOnceWith(root, '')
    }
  },
)

test('a manifest without version and nullable source metadata supports programmatic flags without raw argv', async () => {
  writeFileSync(
    path.join(root, 'package.json'),
    '{"sources":{"example-source":null}}',
  )
  const run = vi.fn()
  const ctx = await runPipeline(
    {
      packageRoot: root,
      packageName: 'example-builder',
      getBuildPaths: () => ({ buildDir: root }),
      stages: [{ name: 'source-copied', run }],
    },
    { force: false },
  )
  expect(ctx?.cacheKey).toMatch(/-0\.0\.0$/u)
  expect(run).toHaveBeenCalledOnce()
  expect(io.create).toHaveBeenCalledOnce()
})
