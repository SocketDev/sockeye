import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

const entry = fileURLToPath(
  new URL('../../../scripts/repo/setup-sockeye.mts', import.meta.url),
)

test('describes the setup entry before interactive or native actions', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      entry,
      '--help',
      '--describe',
      '--json',
    ],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status).toBe(0)
  const manifest = JSON.parse(result.stdout)
  expect(manifest.name).toBe('setup-sockeye.mts')
  expect(manifest.description).toEqual(expect.any(String))
  expect(manifest.description.length).toBeGreaterThan(0)
  expect(manifest.version).toEqual(expect.any(String))
})

test('rejects the removed ad-hoc local installation path', async () => {
  vi.spyOn(process.argv, 'slice').mockReturnValue(['--local'])
  const { main } = await import('../../../scripts/repo/setup-sockeye.mts')
  await expect(main()).rejects.toThrow(
    'Install a Developer ID release artifact',
  )
})
