import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { notarizeMachO } from '../lib/notarize.mts'
const io = vi.hoisted(() => ({
  platform: 'darwin',
  spawn: vi.fn(),
  temp: vi.fn(),
  remove: vi.fn(),
  write: vi.fn(),
  chmod: vi.fn(),
}))
vi.mock(import('../lib/build-env.mts'), () => ({
  getPlatform: () => io.platform,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: io.remove,
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    mkdtempSync: () => '/example/notary-key',
    writeFileSync: io.write,
    chmodSync: io.chmod,
    promises: { ...actual.promises, mkdtemp: io.temp },
  }
})
const credentials = {
  issuerId: 'example-issuer',
  keyId: 'example-key',
  keyPath: '/example/caller-key/AuthKey.p8',
}
beforeEach(() => {
  vi.resetAllMocks()
  io.platform = 'darwin'
  io.temp.mockResolvedValue('/example/notary-zip')
  io.remove.mockResolvedValue(undefined)
  io.spawn.mockResolvedValue({
    code: 0,
    stdout: '{"id":"example-submission","status":"Accepted"}',
    stderr: '',
    pid: 0,
  })
  vi.stubEnv('APPLE_ASC_KEY_ID', '')
  vi.stubEnv('APPLE_ASC_ISSUER_ID', '')
  vi.stubEnv('APPLE_ASC_KEY_P8_B64', '')
})
afterEach(() => vi.unstubAllEnvs())
function useEnvironmentKey() {
  vi.stubEnv('APPLE_ASC_KEY_ID', 'example-key')
  vi.stubEnv('APPLE_ASC_ISSUER_ID', 'example-issuer')
  vi.stubEnv(
    'APPLE_ASC_KEY_P8_B64',
    Buffer.from('example-placeholder-key').toString('base64'),
  )
}

test('skips unavailable credentials and non-macOS without filesystem or command actions', async () => {
  expect(await notarizeMachO('/example/binary')).toBe(false)
  io.platform = 'linux'
  expect(await notarizeMachO('/example/binary', credentials)).toBe(false)
  expect(io.temp).not.toHaveBeenCalled()
  expect(io.spawn).not.toHaveBeenCalled()
})

test('accepted submissions remove the zip and preserve caller-owned keys', async () => {
  expect(await notarizeMachO('/example/binary', credentials)).toBe(true)
  expect(io.spawn).toHaveBeenNthCalledWith(1, 'ditto', [
    '-c',
    '-k',
    '/example/binary',
    '/example/notary-zip/binary.zip',
  ])
  expect(io.spawn.mock.calls[1]?.[1]).toEqual([
    'notarytool',
    'submit',
    '/example/notary-zip/binary.zip',
    '--key',
    credentials.keyPath,
    '--key-id',
    credentials.keyId,
    '--issuer',
    credentials.issuerId,
    '--wait',
    '--output-format',
    'json',
  ])
  expect(io.remove.mock.calls).toEqual([['/example/notary-zip']])
})

test.each([
  '{"status":"Rejected"}',
  '{"id":"example-submission"}',
  '{}',
  'invalid-json',
])(
  'rejects unaccepted or malformed response %s and cleans the archive',
  async response => {
    io.spawn
      .mockResolvedValueOnce({ code: 0, stdout: '' })
      .mockResolvedValueOnce({ code: 0, stdout: response })
    await expect(
      notarizeMachO('/example/binary', credentials),
    ).rejects.toThrow()
    expect(io.remove).toHaveBeenCalledWith('/example/notary-zip')
  },
)

test('submission failures clean owned credentials even if zip deletion rejects', async () => {
  useEnvironmentKey()
  io.spawn.mockRejectedValue(new Error('example submission unavailable'))
  io.remove.mockRejectedValueOnce(new Error('example zip removal failure'))
  await expect(notarizeMachO('/example/binary')).rejects.toThrow()
  expect(io.remove.mock.calls).toEqual([
    ['/example/notary-zip'],
    ['/example/notary-key'],
  ])
  expect(io.chmod).toHaveBeenCalledWith('/example/notary-key/AuthKey.p8', 0o600)
})

test('zip-directory creation failure still removes the owned credential directory', async () => {
  useEnvironmentKey()
  io.temp.mockRejectedValue(new Error('example disk full'))
  await expect(notarizeMachO('/example/binary')).rejects.toThrow()
  expect(io.remove).toHaveBeenCalledWith('/example/notary-key')
  expect(io.spawn).not.toHaveBeenCalled()
})
