import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { beforeEach, expect, test, vi } from 'vitest'

import {
  ensurePayload,
  planFetch,
} from '../../../scripts/repo/bootstrap/fetch-session.mts'

vi.mock(import('node:child_process'), () => ({ spawnSync: vi.fn() }))
vi.mock(import('node:fs'), async importOriginal => ({
  ...(await importOriginal()),
  existsSync: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

test('reuses an existing fleet payload without launching a fetch', () => {
  vi.mocked(existsSync).mockReturnValue(true)
  expect(planFetch('.')).toEqual({ action: 'present' })
  expect(ensurePayload('.')).toBe(0)
  expect(spawnSync).not.toHaveBeenCalled()
})

test('reports a missing fetcher without launching a child', () => {
  vi.mocked(existsSync).mockReturnValue(false)
  expect(planFetch('.')).toEqual({ action: 'no-fetcher' })
  expect(spawnSync).not.toHaveBeenCalled()
})

test('selects the bootstrap fetcher when only the payload is missing', () => {
  vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true)
  expect(planFetch('.')).toMatchObject({ action: 'fetch' })
  expect(spawnSync).not.toHaveBeenCalled()
})
