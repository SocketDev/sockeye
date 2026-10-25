import { afterEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import * as paths from '../../lib/checkpoint/paths.mts'
afterEach(() => vi.restoreAllMocks())
test('constructs checkpoint metadata and archive paths', () => {
  expect(
    paths.getCheckpointDirectory('/example/build', 'example-package'),
  ).toBe('/example/build/checkpoints/example-package')
  expect(paths.getCheckpointFile('/example/checkpoints', 'compiled')).toBe(
    '/example/checkpoints/compiled.json',
  )
  expect(
    paths.getCheckpointArchiveFile('/example/checkpoints', 'compiled'),
  ).toBe('/example/checkpoints/compiled.tar.gz')
  expect(paths.getCheckpointTarballPath('/example/compiled.json')).toBe(
    '/example/compiled.tar.gz',
  )
  expect(paths.getCheckpointCacheHashFile('/example/cache')).toBe(
    '/example/cache/cache-validation.hash',
  )
  expect(paths.getCheckpointLockPath('/example/archive.tar.gz')).toBe(
    '/example/archive.tar.gz.lock',
  )
})
test('resolves relative artifacts while preserving absolute targets', () => {
  expect(paths.getCheckpointArtifactPath('/example/build', 'output.node')).toBe(
    '/example/build/output.node',
  )
  expect(
    paths.getCheckpointArtifactPath('/example/build', '/example/output.node'),
  ).toBe('/example/output.node')
  expect(
    paths.getCheckpointExtractionTarget('/example/output.node', undefined),
  ).toBe('/example/output.node')
  expect(
    paths.getCheckpointExtractionTarget(
      '/example/output.node',
      '/example/restore',
    ),
  ).toBe('/example/restore/output.node')
})
test('temporary paths distinguish the process, time and archive nonce', () => {
  vi.spyOn(Date, 'now').mockReturnValue(12_345)
  expect(paths.getCheckpointTempFilePath('/example/checkpoint.json')).toBe(
    `/example/checkpoint.json.tmp.${process.pid}.12345`,
  )
  expect(paths.getCheckpointTempExtractionDir('/example/archive')).toBe(
    `/example/archive.extract.tmp.${process.pid}.12345`,
  )
  expect(
    paths.getCheckpointTempTarballPath('/example/archive', 'example-nonce'),
  ).toBe(`/example/archive.tmp.${process.pid}.12345.example-nonce`)
})
