import {
  closeSync,
  existsSync,
  openSync,
  promises as fs,
  readSync,
  renameSync,
  statSync,
} from 'node:fs'
import { beforeEach, expect, test, vi } from 'vitest'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  createCheckpointArchive,
  runCheckpointTar,
} from '../../lib/checkpoint/archive.mts'
import { extractTarball } from '../../lib/tarball-utils.mts'
import { withLock } from '../../lib/checkpoint-lock.mts'

vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    existsSync: vi.fn(),
    openSync: vi.fn(),
    closeSync: vi.fn(),
    readSync: vi.fn(),
    renameSync: vi.fn(),
    promises: { ...actual.promises, stat: vi.fn() },
  }
})
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({
    ...(await original()),
    isWin32: () => true,
    isDarwin: () => false,
  }),
)
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDeleteSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('../../lib/checkpoint-lock.mts'), () => ({ withLock: vi.fn() }))
vi.mock(import('../../lib/extraction-cache.mts'), () => ({
  computeSourceHash: () => 'example-artifact-hash',
}))
vi.mock(import('../../lib/tarball-utils.mts'), () => ({
  extractTarball: vi.fn(),
}))
vi.mock(import('../../lib/which-required.mts'), () => ({
  whichRequired: async () => 'tar',
}))

beforeEach(() => {
  vi.resetAllMocks()
  const stats = statSync(new URL(import.meta.url))
  stats.size = 30
  vi.mocked(fs.stat).mockResolvedValue(stats)
  vi.mocked(existsSync).mockReturnValue(false)
  vi.mocked(openSync).mockReturnValue(42)
  vi.mocked(readSync).mockImplementation((...args) => {
    const buffer = args[1]
    if (Buffer.isBuffer(buffer)) {
      buffer[0] = 0x1f
      buffer[1] = 0x8b
    }
    return 2
  })
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: 'output.node\n',
    stderr: '',
  })
  vi.mocked(withLock).mockImplementation(async (...args) => args[2]())
})
function createArchive() {
  return createCheckpointArchive(
    '/example/build',
    'compiled',
    '/example/build/checkpoints/compiled.json',
    {
      artifactPath: 'output.node',
      packageRoot: '/example',
      tarExcludes: ['*.tmp', 'cache'],
    },
  )
}

test('Windows publication forwards exclusions and does not delete absent extraction scratch', async () => {
  expect(await createArchive()).toEqual({
    checkpointAlreadyExists: false,
    artifactHash: 'example-artifact-hash',
  })
  expect(spawn).toHaveBeenNthCalledWith(
    1,
    'tar',
    expect.arrayContaining([
      '--exclude=*.tmp',
      '--exclude=cache',
      '-C',
      '/example/build',
      'output.node',
    ]),
    { env: process.env, stdio: 'pipe' },
  )
  expect(spawn).toHaveBeenNthCalledWith(
    2,
    'tar',
    expect.arrayContaining(['-tzf']),
    { stdio: 'pipe' },
  )
  expect(renameSync).toHaveBeenCalledOnce()
  expect(extractTarball).toHaveBeenCalledOnce()
  expect(safeDeleteSync).not.toHaveBeenCalled()
  expect(closeSync).toHaveBeenCalledWith(42)
})

test('publication preserves non-system rename failures as the diagnostic cause', async () => {
  const failure = new TypeError('example invalid rename argument')
  vi.mocked(renameSync).mockImplementationOnce(() => {
    throw failure
  })
  await expect(createArchive()).rejects.toMatchObject({ cause: failure })
  expect(extractTarball).not.toHaveBeenCalled()
})

test('tar accepts only exit-one file-change warnings', async () => {
  const warning = Object.assign(new Error('example changing file'), {
    code: 1,
    stdout: '',
    stderr: 'tar: example: file changed as we read it\n',
  })
  vi.mocked(spawn).mockRejectedValueOnce(warning)
  await expect(
    runCheckpointTar('tar', ['-czf', 'example.tar.gz']),
  ).resolves.toBeUndefined()
  expect(spawn).toHaveBeenCalledExactlyOnceWith(
    'tar',
    ['-czf', 'example.tar.gz'],
    { env: process.env, stdio: 'pipe' },
  )
})

test.each([
  { code: 2, stderr: 'file changed as we read it' },
  { code: 1, stderr: 'example permission denied' },
  { code: 'ENOENT', stderr: undefined },
])('other tar failures retain their original identity: %j', async details => {
  const failure = Object.assign(new Error('example tar failure'), {
    stdout: '',
    ...details,
  })
  vi.mocked(spawn).mockRejectedValueOnce(failure)
  await expect(runCheckpointTar('tar', [])).rejects.toBe(failure)
})
