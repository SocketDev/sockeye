import { afterEach, expect, test, vi } from 'vitest'
import { getCleanupPaths } from '../lib/ci-cleanup-paths.mts'
afterEach(() => vi.unstubAllEnvs())
test('Darwin cleanup resolves Android SDK from an explicit home before environment', () => {
  vi.stubEnv('HOME', '/example/environment')
  expect(getCleanupPaths('darwin', '/example/explicit')[0]?.path).toBe(
    '/example/explicit/Library/Android/sdk',
  )
  expect(getCleanupPaths('darwin')[0]?.path).toBe(
    '/example/environment/Library/Android/sdk',
  )
})
test('Darwin without a home fails before producing destructive paths', () => {
  vi.stubEnv('HOME', undefined)
  expect(() => getCleanupPaths('darwin')).toThrow()
})
test('unsupported platforms return no cleanup targets', () => {
  expect(getCleanupPaths('freebsd')).toEqual([])
  expect(
    getCleanupPaths('linux').some(task => task.path === '/usr/share/dotnet'),
  ).toBe(true)
  expect(
    getCleanupPaths('win32').some(task => task.path === 'C:\\Android'),
  ).toBe(true)
})
