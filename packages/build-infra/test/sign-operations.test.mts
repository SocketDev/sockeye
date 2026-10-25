import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  adHocSign,
  developerIdSign,
  isIdentityInKeychain,
  isMachOBinary,
} from '../lib/sign.mts'
const io = vi.hoisted(() => ({ platform: 'darwin', spawn: vi.fn() }))
vi.mock(import('../lib/build-env.mts'), () => ({
  getPlatform: () => io.platform,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
let root: string
let binary: string
beforeEach(() => {
  vi.resetAllMocks()
  io.platform = 'darwin'
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '', pid: 0 })
  root = mkdtempSync(path.join(os.tmpdir(), 'sign-operations-'))
  binary = path.join(root, 'example-binary')
  writeFileSync(binary, Buffer.from('cffaedfe', 'hex'))
})
afterEach(async () => {
  await safeDelete(root)
})

test.each(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', '00000000'])(
  'detects Mach-O magic %s using real file bytes',
  async magic => {
    writeFileSync(binary, Buffer.from(magic, 'hex'))
    expect(await isMachOBinary(binary)).toBe(magic !== '00000000')
  },
)

test('missing paths and directories cannot be signed', async () => {
  expect(await isMachOBinary(path.join(root, 'missing'))).toBe(false)
  expect(await isMachOBinary(root)).toBe(false)
  await adHocSign(root)
  expect(await developerIdSign(root)).toBe(false)
  expect(io.spawn).not.toHaveBeenCalled()
})

test('non-macOS signing exits without probing signatures or identities', async () => {
  io.platform = 'linux'
  await adHocSign(binary)
  expect(await developerIdSign(binary)).toBe(false)
  expect(io.spawn).not.toHaveBeenCalled()
})

test('valid signatures avoid signing and pre-sign callbacks', async () => {
  const before = vi.fn()
  await adHocSign(binary, before)
  expect(before).not.toHaveBeenCalled()
  expect(io.spawn.mock.calls).toEqual([
    ['codesign', ['--verify', binary], { stdio: 'ignore' }],
  ])
})

test('invalid signatures trigger the callback and a forced ad-hoc signature', async () => {
  const before = vi.fn()
  io.spawn.mockRejectedValueOnce(
    Object.assign(new Error('example invalid signature'), { code: 1 }),
  )
  await adHocSign(binary, before)
  expect(before).toHaveBeenCalledOnce()
  expect(io.spawn).toHaveBeenLastCalledWith('codesign', [
    '--sign',
    '-',
    '--force',
    binary,
  ])
})

test('failed signing rejects without claiming success', async () => {
  const failure = Object.assign(new Error('example codesign failed'), {
    code: 1,
  })
  io.spawn.mockRejectedValue(failure)
  await expect(adHocSign(binary)).rejects.toBe(failure)
})

test('identity lookup reports unavailable when security rejects', async () => {
  io.spawn.mockRejectedValue(new Error('example inaccessible keychain'))
  expect(await isIdentityInKeychain('example-identity')).toBe(false)
})

test('missing Developer ID falls back to ad-hoc and reports false', async () => {
  expect(await developerIdSign(binary, { identity: 'example-identity' })).toBe(
    false,
  )
  expect(io.spawn.mock.calls.map(call => call[0])).toEqual([
    'security',
    'codesign',
  ])
})

test('Developer ID signing uses the verified identity and hardened runtime', async () => {
  io.spawn.mockResolvedValueOnce({
    code: 0,
    stdout: 'example-identity',
    stderr: '',
    pid: 0,
  })
  expect(await developerIdSign(binary, { identity: 'example-identity' })).toBe(
    true,
  )
  expect(io.spawn).toHaveBeenLastCalledWith('codesign', [
    '--sign',
    'example-identity',
    '--force',
    '--timestamp',
    '--options',
    'runtime',
    binary,
  ])
})

test('Developer ID signing failure cannot downgrade to ad-hoc', async () => {
  io.spawn
    .mockResolvedValueOnce({ code: 0, stdout: 'example-identity' })
    .mockRejectedValueOnce(new Error('example signing denied'))
  await expect(
    developerIdSign(binary, { identity: 'example-identity' }),
  ).rejects.toThrow()
  expect(io.spawn).toHaveBeenCalledTimes(2)
})
