import { beforeEach, expect, test, vi } from 'vitest'
import { statSync } from 'node:fs'
import {
  staticVerifyBinary,
  testBinaryWithDocker,
} from '../lib/binary-verify.mts'
const io = vi.hoisted(() => ({ stat: vi.fn(), spawn: vi.fn() }))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return { ...actual, promises: { ...actual.promises, stat: io.stat } }
})
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.stat.mockResolvedValue(statSync(new URL(import.meta.url)))
  io.spawn.mockResolvedValue({
    code: 0,
    stdout: 'ELF 64-bit x86-64 statically linked',
    stderr: '',
  })
})

test('static inspection rejects empty and unavailable artifacts before spawning', async () => {
  io.stat.mockResolvedValue(
    Object.assign(statSync(new URL(import.meta.url)), { size: 0 }),
  )
  expect(await staticVerifyBinary('/example/node')).toBe(false)
  io.stat.mockRejectedValue(
    Object.assign(new Error('fixture missing binary'), { code: 'ENOENT' }),
  )
  expect(await staticVerifyBinary('/example/node')).toBe(false)
  expect(io.spawn).not.toHaveBeenCalled()
})

test('static inspection validates the target and rejects a mismatched architecture', async () => {
  expect(
    await staticVerifyBinary('/example/node', {
      platform: 'linux',
      arch: 'x64',
      static: true,
    }),
  ).toBe(true)
  expect(io.spawn).toHaveBeenCalledWith('file', ['/example/node'], {
    shell: expect.any(Boolean),
    stdio: 'pipe',
  })
  expect(
    await staticVerifyBinary('/example/node', {
      platform: 'linux',
      arch: 'arm64',
    }),
  ).toBe(false)
})

test('static inspection retains basic validation when the file utility is unavailable', async () => {
  io.spawn.mockRejectedValue(
    Object.assign(new Error('fixture unavailable utility'), { code: 'ENOENT' }),
  )
  expect(await staticVerifyBinary('/example/node')).toBe(true)
})

test('empty file descriptions fail target format validation', async () => {
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  expect(await staticVerifyBinary('/example/node', { platform: 'linux' })).toBe(
    false,
  )
})

test.each(['x64', 'arm64'])(
  'container validation runs three probes for %s',
  async expectedArch => {
    expect(
      await testBinaryWithDocker('/example/bin/node', { expectedArch }),
    ).toBe(true)
    expect(io.spawn).toHaveBeenCalledTimes(3)
    const commands = io.spawn.mock.calls.map(call => call[1])
    const prefix = [
      'run',
      '--rm',
      '--platform',
      expectedArch === 'arm64' ? 'linux/arm64' : 'linux/amd64',
      '-v',
      '/example/bin:/test',
      'alpine:latest',
      '/test/node',
    ]
    expect(commands[0]).toEqual([...prefix, '--version'])
    expect(commands[1]).toEqual([
      ...prefix,
      '-e',
      "console.log('Hello from node-smol')",
    ])
    expect(commands[2]).toEqual([
      ...prefix,
      '-e',
      "require('fs'); require('path'); require('os')",
    ])
  },
)

test.each([0, 1, 2])(
  'container validation stops after failed probe %s',
  async failureIndex => {
    for (let index = 0; index < failureIndex; index += 1) {
      io.spawn.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    }
    io.spawn.mockRejectedValueOnce(
      Object.assign(new Error('fixture probe failed'), { code: 2 }),
    )
    expect(await testBinaryWithDocker('/example/bin/node')).toBe(false)
    expect(io.spawn).toHaveBeenCalledTimes(failureIndex + 1)
  },
)
