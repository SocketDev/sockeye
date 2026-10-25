import { beforeEach, expect, test, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  getCheckpointData,
  shouldRun,
} from 'local-build-infra/lib/checkpoint-manager'
import { cleanCheckpoint } from 'local-build-infra/lib/build-operations'
import { cloneNodeSource } from '../../scripts/source-copied/shared/copy-source.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  checkpoint: vi.fn(),
  paths: new Set<string>(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
  promises: { ...(await original()).promises, cp: vi.fn() },
}))
vi.mock(import('local-build-infra/lib/build-operations'), () => ({
  cleanCheckpoint: vi.fn(),
  createCheckpoint: io.checkpoint,
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), () => ({
  getCheckpointData: vi.fn(),
  shouldRun: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(),
  safeMkdir: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../../scripts/source-copied/shared/paths.mts'), () => ({
  UPSTREAM_PATH: '/example/upstream/node',
}))
const config = {
  cleanBuild: false,
  nodeSha: 'a'.repeat(40),
  nodeVersion: '24.0.0',
  packageName: 'example-node',
  sharedBuildDir: '/example/build',
  sharedSourceDir: '/example/build/source',
}
beforeEach(() => {
  vi.resetAllMocks()
  io.paths = new Set([
    '/example/build/source/configure',
    '/example/upstream/node',
  ])
  io.exists.mockImplementation(file => io.paths.has(file))
  vi.mocked(shouldRun).mockResolvedValue(true)
  vi.mocked(getCheckpointData).mockResolvedValue({
    nodeVersion: config.nodeVersion,
    nodeSha: config.nodeSha,
  })
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: config.nodeSha,
    stderr: '',
    pid: 0,
  })
  vi.mocked(safeDelete).mockImplementation(async file => {
    io.paths.delete(String(file))
  })
  io.checkpoint.mockImplementation(async (dir, name, validate) => {
    await validate()
  })
})
test('skips matching cached source without querying Git or touching files', async () => {
  vi.mocked(shouldRun).mockResolvedValue(false)
  await cloneNodeSource(config)
  expect(fs.cp).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
  expect(io.checkpoint).not.toHaveBeenCalled()
})
test('verifies upstream identity before copying and excludes Git metadata', async () => {
  await cloneNodeSource(config)
  expect(spawn).toHaveBeenCalledExactlyOnceWith(
    'git',
    ['-C', '/example/upstream/node', 'rev-parse', 'HEAD'],
    { stdio: 'pipe' },
  )
  expect(safeMkdir).toHaveBeenCalledExactlyOnceWith('/example/build')
  expect(vi.mocked(fs.cp).mock.invocationCallOrder[0]).toBeGreaterThan(
    vi.mocked(spawn).mock.invocationCallOrder[0]!,
  )
  const options = vi.mocked(fs.cp).mock.calls[0]?.[2]
  expect(options).toMatchObject({ force: true, recursive: true })
  expect(
    await options?.filter?.(
      '/example/upstream/node/src/node.cc',
      '/example/destination',
    ),
  ).toBe(true)
  expect(
    await options?.filter?.(
      '/example/upstream/node/.git/config',
      '/example/destination',
    ),
  ).toBe(false)
  expect(io.checkpoint.mock.calls[0]?.[3]).toEqual({
    artifactPath: config.sharedSourceDir,
    nodeSha: config.nodeSha,
    nodeVersion: config.nodeVersion,
    packageName: config.packageName,
  })
})
test.each(['clean', 'version'])(
  'replaces existing source for %s changes and clears its checkpoint',
  async reason => {
    io.paths.add(config.sharedSourceDir)
    if (reason === 'version') {
      vi.mocked(shouldRun).mockResolvedValue(false)
      vi.mocked(getCheckpointData).mockResolvedValue({
        nodeVersion: '23.0.0',
        nodeSha: config.nodeSha,
      })
    }
    await cloneNodeSource({ ...config, cleanBuild: reason === 'clean' })
    expect(safeDelete).toHaveBeenCalledExactlyOnceWith(config.sharedSourceDir, {
      recursive: true,
    })
    expect(cleanCheckpoint).toHaveBeenCalledExactlyOnceWith(
      config.sharedBuildDir,
      config.packageName,
    )
    expect(fs.cp).toHaveBeenCalledTimes(1)
  },
)
test('refuses missing upstream and mismatched commits before copying', async () => {
  io.paths.delete('/example/upstream/node')
  await expect(cloneNodeSource(config)).rejects.toThrow()
  expect(spawn).not.toHaveBeenCalled()
  io.paths.add('/example/upstream/node')
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: 'b'.repeat(40),
    stderr: '',
    pid: 0,
  })
  await expect(cloneNodeSource(config)).rejects.toThrow()
  expect(fs.cp).not.toHaveBeenCalled()
})
test('refuses copied trees without configure before completing their checkpoint', async () => {
  io.paths.delete('/example/build/source/configure')
  await expect(
    cloneNodeSource({ ...config, nodeSha: undefined }),
  ).rejects.toThrow()
  expect(spawn).not.toHaveBeenCalled()
  expect(io.checkpoint).toHaveBeenCalledTimes(1)
})
test('recovers a missing checkpoint from valid existing source without copying', async () => {
  io.paths.add(config.sharedSourceDir)
  await cloneNodeSource(config)
  expect(fs.cp).not.toHaveBeenCalled()
  expect(io.checkpoint.mock.calls[0]?.[3]).toMatchObject({
    artifactPath: config.sharedSourceDir,
    nodeSha: config.nodeSha,
    nodeVersion: config.nodeVersion,
  })
})
test('recopies invalid existing source once and verifies the fresh tree', async () => {
  io.paths.add(config.sharedSourceDir)
  io.paths.delete('/example/build/source/configure')
  vi.mocked(fs.cp).mockImplementation(async () => {
    io.paths.add('/example/build/source/configure')
  })
  await cloneNodeSource(config)
  expect(safeDelete).toHaveBeenCalledExactlyOnceWith(config.sharedSourceDir, {
    recursive: true,
  })
  expect(fs.cp).toHaveBeenCalledTimes(1)
  expect(io.checkpoint).toHaveBeenCalledTimes(1)
  expect(shouldRun).toHaveBeenCalledTimes(2)
})
test('propagates a rejected Git process without copying or checkpointing', async () => {
  const failure = Object.assign(new Error('fixture Git failure'), { code: 1 })
  vi.mocked(spawn).mockRejectedValue(failure)
  await expect(cloneNodeSource(config)).rejects.toBe(failure)
  expect(fs.cp).not.toHaveBeenCalled()
  expect(io.checkpoint).not.toHaveBeenCalled()
})
