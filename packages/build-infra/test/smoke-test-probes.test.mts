import { beforeEach, expect, test, vi } from 'vitest'
import {
  isDockerAvailable,
  isQemuAvailable,
  isRosettaAvailable,
  isSelfExtractingBinary,
} from '../lib/smoke-test-strategy.mts'
import { runCommand } from '../lib/script-runner.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
})
test('emulator probes execute only availability commands', async () => {
  expect(await isDockerAvailable()).toBe(true)
  expect(await isQemuAvailable('arm64')).toBe(true)
  expect(await isQemuAvailable('x64')).toBe(true)
  expect(await isRosettaAvailable()).toBe(true)
  expect(io.spawn.mock.calls.map(call => call.slice(0, 2))).toEqual([
    ['docker', ['--version']],
    ['which', ['qemu-aarch64-static']],
    ['which', ['qemu-x86_64-static']],
    ['arch', ['-x86_64', '/usr/bin/true']],
  ])
})
test('failed emulator commands report unavailable instead of executing a binary', async () => {
  io.spawn.mockRejectedValue(new Error('example command unavailable'))
  expect(await isDockerAvailable()).toBe(false)
  expect(await isQemuAvailable('arm64')).toBe(false)
  expect(await isRosettaAvailable()).toBe(false)
})
test.each([
  ['/example/Compressed/binary', true],
  ['/example/final/binary', true],
  ['C:\\example\\Final\\binary.exe', true],
  ['/example/Finalized/binary', false],
  ['/example/Compiled/binary', false],
])(
  'self-extracting detection uses complete path segments: %s',
  (file, expected) => {
    expect(isSelfExtractingBinary(file)).toBe(expected)
  },
)
test('command runner forwards directory and inherits output without swallowing launch failures', async () => {
  await runCommand('example-compiler', ['--version'], '/example/build')
  expect(io.spawn).toHaveBeenCalledWith(
    'example-compiler',
    ['--version'],
    expect.objectContaining({ cwd: '/example/build', stdio: 'inherit' }),
  )
  const failure = new Error('example launch failure')
  io.spawn.mockRejectedValue(failure)
  await expect(runCommand('example-compiler')).rejects.toBe(failure)
})
