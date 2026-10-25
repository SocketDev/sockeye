import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  runCheckpointTar,
  validateCreatedCheckpointArchive,
} from '../../lib/checkpoint/archive.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
let root: string
beforeEach(async () => {
  vi.resetAllMocks()
  root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-archive-errors-'))
})
afterEach(async () => {
  await safeDelete(root)
})
test('tar launch failures keep their original error identity', async () => {
  const failure = new Error('example executable missing')
  io.spawn.mockRejectedValue(failure)
  await expect(runCheckpointTar('/example/tar', [])).rejects.toBe(failure)
})
test.each(['', 'unrelated-artifact\n'])(
  'a gzip header without the expected listed artifact is rejected',
  async listing => {
    const archive = path.join(root, 'example.tar.gz')
    await writeFile(archive, Buffer.from([0x1f, 0x8b, 0x08, 0x00]))
    io.spawn.mockResolvedValue({ code: 0, stdout: listing, stderr: '' })
    await expect(
      validateCreatedCheckpointArchive(archive, '/example/tar', {
        resolvedArtifactPath: '/example/artifact',
        tarBase: 'expected-artifact',
      }),
    ).rejects.toThrow()
  },
)
