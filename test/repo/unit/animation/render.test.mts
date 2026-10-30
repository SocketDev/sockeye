import { beforeEach, expect, test, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: runtime.mkdir,
  readFile: runtime.readFile,
}))
vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: runtime.spawn,
}))

import { renderFingerprintAnimation } from '../../../../scripts/repo/animation/render.mts'
import {
  FINGERPRINT_ATLAS,
  FINGERPRINT_MANIFEST,
  FINGERPRINT_RENDER_ROOT,
  FINGERPRINT_RENDERER,
} from '../../../../scripts/repo/paths/animation.mts'

beforeEach(() => {
  vi.resetAllMocks()
  runtime.readFile.mockResolvedValue(
    JSON.stringify({ frames: ['first', 'last'] }),
  )
  runtime.spawn.mockImplementation(async (command, args) => ({
    code: 0,
    stdout:
      command === 'magick' && args.includes('-crop')
        ? Array(64).fill('0').join('\n')
        : '',
  }))
})

test('builds the locked renderer and embeds frames with a transparent background', async () => {
  await renderFingerprintAnimation()
  expect(runtime.spawn).toHaveBeenCalledWith(
    'cargo',
    expect.arrayContaining([
      'build',
      '--release',
      '--locked',
      '--manifest-path',
      FINGERPRINT_MANIFEST,
    ]),
    expect.objectContaining({ cwd: FINGERPRINT_RENDER_ROOT }),
  )
  expect(runtime.spawn).toHaveBeenCalledWith(
    FINGERPRINT_RENDERER,
    expect.arrayContaining(['frame', '0,1', '--renderer', 'gpu']),
    expect.anything(),
  )
  expect(runtime.spawn).toHaveBeenCalledWith(
    'magick',
    expect.arrayContaining([
      'montage',
      '-background',
      'none',
      FINGERPRINT_ATLAS,
    ]),
    expect.anything(),
  )
})

test('stops before rendering when the locked build fails', async () => {
  runtime.spawn.mockResolvedValue({ code: 1 })
  await expect(renderFingerprintAnimation()).rejects.toThrow()
  expect(runtime.spawn).toHaveBeenCalledTimes(1)
})

test.each([
  { code: 0, stdout: Array(64).fill('1').join('\n') },
  { code: 0, stdout: '0' },
  { code: 1, stdout: Array(64).fill('0').join('\n') },
])('rejects invalid transparency checks: $code', async result => {
  runtime.spawn.mockImplementation(async (command, args) =>
    command === 'magick' && args.includes('-crop') ? result : { code: 0 },
  )
  await expect(renderFingerprintAnimation()).rejects.toThrow()
  expect(runtime.spawn).not.toHaveBeenCalledWith(
    FINGERPRINT_RENDERER,
    expect.arrayContaining(['strip']),
    expect.anything(),
  )
})
