import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  collectBuildSourceFiles,
  normalizeAndDedup,
} from '../../scripts/common/shared/collect-build-source-files.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  glob: vi.fn(),
  sources: vi.fn(),
  existing: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(import('@socketsecurity/lib-stable/globs/match'), () => ({
  glob: io.glob,
}))
vi.mock(import('local-build-infra/lib/paths'), () => ({
  getSocketSourceDir: (root, name) => path.join(root, 'src', name),
}))
vi.mock(import('../../scripts/common/shared/paths.mts'), () => ({
  PACKAGE_ROOT: '/example/node',
  getBuildSourcePaths: io.sources,
  getExistingPaths: io.existing,
}))
vi.mock(import('../../scripts/paths.mts'), () => ({
  BIN_INFRA_DIR: '/example/bin-infra',
  BINJECT_DIR: '/example/binject',
  BUILD_INFRA_DIR: '/example/build-infra',
  PROMISE_INFRA_DIR: '/example/promise',
  TEMPORAL_INFRA_DIR: '/example/temporal',
  TEMPORAL_HEADERS_DIR: '/example/temporal/include',
}))
const collector = fileURLToPath(
  new URL(
    '../../scripts/common/shared/collect-build-source-files.mts',
    import.meta.url,
  ),
)
beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(true)
  io.existing.mockImplementation(paths => paths)
  io.sources.mockReturnValue({
    patches: ['/example/patches'],
    additions: [
      '/example/node/additions/source-patched/shared',
      '/example/unmatched',
    ],
    common: ['/example/common'],
    scripts: ['/example/released'],
  })
  io.glob.mockImplementation(async (pattern, options) => [
    path.join(
      options.cwd,
      pattern === '*.patch'
        ? 'feature.patch'
        : pattern === '*.mts'
          ? 'build.mts'
          : 'source.cc',
    ),
  ])
})
test('collects phase scripts, canonical native trees and tracked additions', async () => {
  const result = await collectBuildSourceFiles(
    'binary-released',
    'linux',
    'arm64',
  )
  expect(io.sources).toHaveBeenCalledWith('binary-released', 'linux', 'arm64')
  expect(result).toEqual(
    expect.arrayContaining([
      '/example/patches/feature.patch',
      '/example/common/build.mts',
      '/example/released/build.mts',
      '/example/temporal/include/source.cc',
      '/example/promise/src/promise/source.cc',
      '/example/node/additions/source-patched/source.cc',
      '/example/node/additions/source-patched/deps/libdeflate/libdeflate.gyp',
      collector,
    ]),
  )
  expect(io.glob).toHaveBeenCalledWith(
    '**/*',
    expect.objectContaining({
      cwd: '/example/node/additions/source-patched',
      ignore: expect.arrayContaining([
        '**/deps/libdeflate/**',
        '**/deps/fast-webstreams/**',
        '**/src/socketsecurity/build-infra/**',
      ]),
    }),
  )
})
test('does not scan absent trees but always hashes the collector itself', async () => {
  io.exists.mockReturnValue(false)
  io.existing.mockReturnValue([])
  expect(await collectBuildSourceFiles('finalized', 'win32', 'x64')).toEqual([
    collector,
  ])
  expect(io.glob).not.toHaveBeenCalled()
})
test('deduplicates overlapping additions and common-script results', async () => {
  io.glob.mockResolvedValue([
    collector,
    '/example/shared.cc',
    '/example/shared.cc',
  ])
  const result = await collectBuildSourceFiles(
    'binary-compressed',
    'darwin',
    'arm64',
  )
  expect(result.filter(filename => filename === collector)).toHaveLength(1)
  expect(
    result.filter(filename => filename === '/example/shared.cc'),
  ).toHaveLength(1)
})
test('normalizes Windows separators before deduplication', () => {
  expect(
    normalizeAndDedup([
      'C:\\example\\source.cc',
      'C:/example/source.cc',
      '/example/header.h',
    ]),
  ).toEqual(['C:/example/source.cc', '/example/header.h'])
})
test('propagates scan failure rather than computing a partial cache key', async () => {
  const failure = new Error('Fixture scan denied')
  io.glob.mockRejectedValue(failure)
  await expect(
    collectBuildSourceFiles('finalized', 'linux', 'x64'),
  ).rejects.toBe(failure)
})
