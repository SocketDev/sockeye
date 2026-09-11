import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }))
vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => mocks)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
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

test.runIf(process.platform === 'darwin')(
  'local installation builds and signs production with inherited environment',
  async () => {
    vi.stubEnv('BUILD_MODE', 'dev')
    vi.stubEnv('SOCKEYE_TEST_INHERITED', 'example-value')
    vi.spyOn(process.argv, 'slice').mockReturnValue(['--local'])
    mocks.spawn
      .mockResolvedValueOnce({ code: 0 })
      .mockResolvedValueOnce({ code: 1 })
    const { main } = await import('../../../scripts/repo/setup-sockeye.mts')
    await expect(main()).rejects.toMatchObject({ exitCode: 1 })
    const options = { env: { ...process.env, BUILD_MODE: 'prod' } }
    expect(mocks.spawn).toHaveBeenNthCalledWith(
      1,
      'pnpm',
      ['run', 'build'],
      options,
    )
    expect(mocks.spawn).toHaveBeenNthCalledWith(
      2,
      'pnpm',
      ['run', 'sign', '--ad-hoc', '--run'],
      options,
    )
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(mocks.spawnSync).not.toHaveBeenCalled()
    expect(process.env['BUILD_MODE']).toBe('dev')
  },
)
