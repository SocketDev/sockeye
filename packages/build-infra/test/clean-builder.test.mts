import { beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { cleanCheckpoint } from '../lib/checkpoint-manager.mts'
import { cleanBuilder } from '../lib/clean-builder.mts'

vi.mock(import('node:fs'), async importOriginal => ({
  ...(await importOriginal()),
  existsSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(),
}))
vi.mock(import('../lib/checkpoint-manager.mts'), () => ({
  cleanCheckpoint: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('builder cleanup', () => {
  test('deletes existing directories before cleaning configured checkpoint modes', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false)
    const activeLogger = { info: vi.fn(), success: vi.fn() }
    await cleanBuilder('example-builder', {
      packageDir: '/example/package',
      cleanDirs: ['output', 'missing'],
      buildDir: 'artifacts',
      checkpointModes: ['prod', 'dev'],
      logger: activeLogger,
    })
    expect(vi.mocked(safeDelete).mock.calls).toEqual([
      ['/example/package/output'],
    ])
    expect(vi.mocked(cleanCheckpoint).mock.calls).toEqual([
      ['/example/package/artifacts/prod', ''],
      ['/example/package/artifacts/dev', ''],
    ])
    expect(vi.mocked(safeDelete).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(cleanCheckpoint).mock.invocationCallOrder[0]!,
    )
  })

  test('skips checkpoint cleanup when disabled', async () => {
    await cleanBuilder('example-builder', {
      packageDir: '/example/package',
      checkpointModes: [],
      logger: { info: vi.fn(), success: vi.fn() },
    })
    expect(vi.mocked(safeDelete).mock.calls).toHaveLength(0)
    expect(vi.mocked(cleanCheckpoint).mock.calls).toHaveLength(0)
  })

  test('stops checkpoint cleanup when artifact removal fails', async () => {
    const failure = new Error('fixture deletion failed')
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(safeDelete).mockRejectedValue(failure)
    await expect(
      cleanBuilder('example-builder', {
        packageDir: '/example/package',
        logger: { info: vi.fn(), success: vi.fn() },
      }),
    ).rejects.toBe(failure)
    expect(vi.mocked(cleanCheckpoint).mock.calls).toHaveLength(0)
  })
})
