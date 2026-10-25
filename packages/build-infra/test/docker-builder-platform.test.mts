import { expect, test, vi } from 'vitest'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { cleanAppleDoubleFiles } from '../lib/docker-builder.mts'

vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({
    ...(await original()),
    isDarwin: () => false,
  }),
)
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))

test('leaves non-macOS build trees untouched by AppleDouble cleanup', async () => {
  expect(await cleanAppleDoubleFiles('/example/build')).toBe(0)
  expect(spawn).not.toHaveBeenCalled()
})
