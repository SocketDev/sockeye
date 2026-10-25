import { beforeEach, expect, test, vi } from 'vitest'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { installTool, isToolInstalled } from '../lib/install-tools.mts'

vi.mock(import('node:os'), () => ({ default: { platform: () => 'darwin' } }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolVersion: vi.fn(() => '3.6.3'),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(spawn).mockImplementation(async (command, args) => {
    if (command === 'brew' && args?.[0] === 'list') {
      return { code: 0, pid: 0, stdout: 'openssl@3 3.6.3\n', stderr: '' }
    }
    throw new Error('fixture command unavailable')
  })
})

test('keeps an installed keg-only formula without installing or upgrading', async () => {
  expect(await installTool('openssl@3')).toBe(true)
  expect(vi.mocked(spawn).mock.calls.map(call => call.slice(0, 2))).toEqual([
    ['which', ['openssl@3']],
    ['brew', ['list', '--versions', 'openssl@3']],
  ])
  expect(vi.mocked(spawn).mock.calls.at(-1)?.[2]).toMatchObject({
    env: { HOMEBREW_NO_ANALYTICS: '1' },
    stdio: 'pipe',
  })
})

test.each(['', 'openssl@1.1 1.1.1\n', 'openssl@3\n'])(
  'does not accept an absent or different formula: %j',
  async stdout => {
    vi.mocked(spawn).mockRejectedValueOnce(new Error('fixture missing binary'))
    vi.mocked(spawn).mockResolvedValueOnce({
      code: 0,
      pid: 0,
      stdout,
      stderr: '',
    })
    expect(await isToolInstalled('openssl@3')).toBe(false)
  },
)

test('reports unavailable Homebrew as missing without installing', async () => {
  vi.mocked(spawn).mockRejectedValue(new Error('fixture unavailable brew'))
  expect(await isToolInstalled('openssl@3')).toBe(false)
})

test('rejects a failed query even when it returns a matching formula', async () => {
  vi.mocked(spawn).mockRejectedValueOnce(new Error('fixture missing binary'))
  vi.mocked(spawn).mockResolvedValueOnce({
    code: 1,
    pid: 0,
    stdout: 'openssl@3 3.6.3\n',
    stderr: '',
  })
  expect(await isToolInstalled('openssl@3')).toBe(false)
})

test('installs a formula that has no installed version', async () => {
  vi.mocked(spawn).mockImplementation(async (command, args) => {
    if (command === 'which' && args?.[0] === 'openssl@3') {
      throw new Error('fixture missing binary')
    }
    return { code: 0, pid: 0, stdout: '', stderr: '' }
  })
  expect(await installTool('openssl@3')).toBe(true)
  expect(vi.mocked(spawn).mock.calls.at(-1)?.slice(0, 2)).toEqual([
    'brew',
    ['install', 'openssl@3'],
  ])
})
