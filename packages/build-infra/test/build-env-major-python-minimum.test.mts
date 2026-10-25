import { expect, test, vi } from 'vitest'
import { checkPython } from '../lib/build-env-toolchain.mts'

const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/version-metadata.mts'), () => ({
  getMinPythonVersion: () => '3',
}))

test('a major-only Python minimum permits minor zero and rejects the previous major', async () => {
  for (const version of ['3.0.0', '2.7.18']) {
    io.spawn.mockReset().mockResolvedValue({
      code: 0,
      stdout: `Python ${version}`,
      stderr: '',
      pid: 0,
    })
    expect(await checkPython()).toEqual({
      available: true,
      command: 'python3',
      meetsRequirement: version === '3.0.0',
      version,
    })
    expect(io.spawn.mock.calls[1]?.[1]).toEqual(['--version'])
  }
})
