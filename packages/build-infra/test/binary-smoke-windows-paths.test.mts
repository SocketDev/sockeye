import { expect, test, vi } from 'vitest'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { runBinaryTest } from '../lib/binary-smoke-test.mts'

vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({
    ...(await original()),
    isWin32: () => true,
  }),
)
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../lib/smoke-test-strategy.mts'), async original => ({
  ...(await original()),
  isSelfExtractingBinary: () => false,
}))

test('normalizes Windows executable paths before the smoke process starts', async () => {
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: 'example output',
    stderr: '',
    pid: 123,
  })
  expect(
    await runBinaryTest('C:/example/bin/../tool.exe', ['--version'], 'version'),
  ).toBe(true)
  expect(spawn).toHaveBeenCalledWith(
    'C:\\example\\tool.exe',
    ['--version'],
    expect.objectContaining({ timeout: 30_000 }),
  )
})
