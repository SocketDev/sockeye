import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { beforeEach, expect, test, vi } from 'vitest'

import {
  ensurePayload,
  planFetch,
} from '../../../../scripts/repo/bootstrap/fetch-session.mts'

vi.mock(import('node:child_process'), () => ({ spawnSync: vi.fn() }))
vi.mock(import('node:fs'), async importOriginal => ({
  ...(await importOriginal()),
  existsSync: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

test('runs the bootstrap fetcher to verify an existing fleet payload', () => {
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<
    typeof spawnSync
  >)
  expect(planFetch('.')).toEqual({
    action: 'ensure',
    fleet: 'scripts/repo/bootstrap/fleet.mjs',
  })
  expect(ensurePayload('.')).toBe(0)
  expect(spawnSync).toHaveBeenCalledWith(
    process.execPath,
    ['scripts/repo/bootstrap/fleet.mjs', '--quiet', '--cached'],
    { cwd: '.', encoding: 'utf8' },
  )
})

test('reports a missing fetcher without launching a child', () => {
  vi.mocked(existsSync).mockReturnValue(false)
  expect(planFetch('.')).toEqual({ action: 'no-fetcher' })
  expect(spawnSync).not.toHaveBeenCalled()
})

test('reuses an existing payload when the bootstrap fetcher is missing', () => {
  vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true)
  expect(planFetch('.')).toEqual({ action: 'present' })
  expect(spawnSync).not.toHaveBeenCalled()
})
