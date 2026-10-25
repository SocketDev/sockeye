import { beforeEach, expect, test, vi } from 'vitest'
import { CHECKPOINTS } from 'local-build-infra/lib/constants'
import { inspectReleaseCheckpoints } from '../../scripts/binary-released/shared/release-checkpoints.mts'

const io = vi.hoisted(() => ({
  has: vi.fn(),
  data: vi.fn(),
  fingerprint: vi.fn(),
}))
vi.mock(
  import('local-build-infra/lib/checkpoint-manager'),
  async importOriginal => ({
    ...(await importOriginal()),
    hasCheckpoint: io.has,
    getCheckpointData: io.data,
  }),
)
vi.mock(
  import('local-build-infra/lib/checkpoint-cache-key'),
  async importOriginal => ({
    ...(await importOriginal()),
    computeBuildInputsFingerprint: io.fingerprint,
  }),
)

const config = {
  buildDir: '/example/build',
  checkpointChain: [CHECKPOINTS.FINALIZED, CHECKPOINTS.SOURCE_PATCHED],
  packageName: 'example-tool',
  packageRoot: '/example/package',
}

beforeEach(() => {
  vi.clearAllMocks()
  io.fingerprint.mockReturnValue('example-fingerprint')
  io.has.mockReturnValue(false)
})

test('continues a fresh build when no checkpoint exists', async () => {
  await expect(inspectReleaseCheckpoints(config)).resolves.toBe(false)
  expect(io.data).not.toHaveBeenCalled()
})

test('accepts a finalized checkpoint only with a current input fingerprint', async () => {
  io.has.mockReturnValue(true)
  io.data.mockResolvedValue({ inputsFingerprint: 'example-fingerprint' })
  await expect(inspectReleaseCheckpoints(config)).resolves.toBe(true)
  expect(io.has).toHaveBeenCalledOnce()
})

for (const data of [
  undefined,
  {},
  { inputsFingerprint: 'stale-fingerprint' },
]) {
  test(`rejects finalized metadata ${JSON.stringify(data)} without accepting older checkpoints`, async () => {
    io.has.mockReturnValue(true)
    io.data.mockResolvedValue(data)
    await expect(inspectReleaseCheckpoints(config)).resolves.toBe(false)
    expect(io.has).toHaveBeenCalledOnce()
  })
}

test('continues build work when only an intermediate checkpoint exists', async () => {
  io.has.mockImplementation(
    (buildDir, packageName, checkpoint) =>
      checkpoint === CHECKPOINTS.SOURCE_PATCHED,
  )
  await expect(inspectReleaseCheckpoints(config)).resolves.toBe(false)
  expect(io.data).not.toHaveBeenCalled()
})
