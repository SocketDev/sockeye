import { beforeEach, expect, test, vi } from 'vitest'
import {
  applyPatch,
  validatePatch,
} from 'local-build-infra/lib/patch-validator'
import { shouldRun } from 'local-build-infra/lib/checkpoint-manager'
import { glob } from '@socketsecurity/lib-stable/globs/match'
import {
  applySocketPatches,
  computePatchChainCachePaths,
  computeSourcePatchedCachePaths,
  findSocketPatches,
} from '../../scripts/source-patched/shared/apply-patches.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  readdir: vi.fn(),
  checkpoint: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
  readdirSync: io.readdir,
}))
vi.mock(import('local-build-infra/lib/build-operations'), () => ({
  createCheckpoint: io.checkpoint,
}))
vi.mock(import('local-build-infra/lib/checkpoint-manager'), () => ({
  shouldRun: vi.fn(),
}))
vi.mock(import('local-build-infra/lib/patch-validator'), () => ({
  applyPatch: vi.fn(),
  validatePatch: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/globs/match'), () => ({
  glob: vi.fn(),
}))
vi.mock(
  import('../../scripts/binary-released/shared/prepare-external-sources.mts'),
  () => ({
    EXTERNAL_PIN_FILES: ['/example/pin.json', '/example/absent-pin.json'],
    MONOREPO_PACKAGE_SOURCES: [
      { from: '/example/additions' },
      { from: '/example/absent-additions' },
    ],
  }),
)
const config = {
  buildDir: '/example/build',
  buildPatchesDir: '/example/dynamic',
  cleanBuild: false,
  modeSourceDir: '/example/source',
  nodeVersion: '24.0.0',
  packageName: 'example-node',
  patchedFile: '/example/source/patched.cc',
  patchesReleaseDir: '/example/static',
}
beforeEach(() => {
  vi.resetAllMocks()
  io.exists.mockImplementation(file => !String(file).includes('absent'))
  io.readdir.mockImplementation(dir =>
    dir === config.patchesReleaseDir
      ? ['002-second.patch', '001-first.patch', 'README.md']
      : ['001-first.patch', '003-third.patch', 'notes.txt'],
  )
  vi.mocked(glob).mockResolvedValue(['/example/additions/feature.cc'])
  vi.mocked(shouldRun).mockResolvedValue(true)
  vi.mocked(validatePatch).mockResolvedValue(true)
  io.checkpoint.mockImplementation(async (dir, name, validate) => {
    await validate()
  })
})
test('orders patches and lets dynamic files replace matching static names', () => {
  expect(
    findSocketPatches(config.patchesReleaseDir, config.buildPatchesDir),
  ).toEqual([
    {
      name: '001-first.patch',
      path: '/example/dynamic/001-first.patch',
      source: 'build/patches/',
    },
    {
      name: '002-second.patch',
      path: '/example/static/002-second.patch',
      source: 'patches/',
    },
    {
      name: '003-third.patch',
      path: '/example/dynamic/003-third.patch',
      source: 'build/patches/',
    },
  ])
  io.exists.mockReturnValue(false)
  expect(
    findSocketPatches(config.patchesReleaseDir, config.buildPatchesDir),
  ).toEqual([])
})
test('includes upstream sentinels, addition source files and existing external pins in cache identity', async () => {
  const patchPaths = computePatchChainCachePaths(config)
  expect(patchPaths.slice(-2)).toEqual([
    '/example/source/src/node.cc',
    '/example/source/src/node_main.cc',
  ])
  expect(await computeSourcePatchedCachePaths(config)).toEqual([
    ...patchPaths,
    '/example/additions/feature.cc',
    '/example/pin.json',
  ])
  expect(glob).toHaveBeenCalledExactlyOnceWith(
    '**/*.{c,cc,cpp,h,hh,hpp,cjs,js,mjs}',
    { absolute: true, cwd: '/example/additions' },
  )
  io.exists.mockReturnValue(false)
  expect(computePatchChainCachePaths(config)).toEqual([])
})
test('skips fresh combined cache before validation or mutation', async () => {
  vi.mocked(shouldRun).mockResolvedValue(false)
  await applySocketPatches(config)
  expect(validatePatch).not.toHaveBeenCalled()
  expect(applyPatch).not.toHaveBeenCalled()
  expect(io.checkpoint).not.toHaveBeenCalled()
})
test('refuses a stale cache with no patches', async () => {
  io.readdir.mockReturnValue([])
  await expect(applySocketPatches(config)).rejects.toThrow()
  expect(applyPatch).not.toHaveBeenCalled()
})
test.each([true, false])(
  'refreshes addition-only cache after checking patched output, exists=%s',
  async present => {
    vi.mocked(shouldRun)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    io.exists.mockImplementation(file =>
      file === config.patchedFile ? present : !String(file).includes('absent'),
    )
    if (present) {
      await expect(applySocketPatches(config)).resolves.toBeUndefined()
    } else {
      await expect(applySocketPatches(config)).rejects.toThrow()
    }
    expect(applyPatch).not.toHaveBeenCalled()
    expect(io.checkpoint.mock.calls[0]?.[3]).toMatchObject({
      artifactPath: config.modeSourceDir,
      patchCount: 3,
      tarExcludes: ['out'],
    })
  },
)
test('validates then applies each patch against the cumulative tree', async () => {
  const events: string[] = []
  vi.mocked(validatePatch).mockImplementation(async file => {
    events.push(`validate:${file}`)
    return true
  })
  vi.mocked(applyPatch).mockImplementation(async file => {
    events.push(`apply:${file}`)
  })
  await applySocketPatches({ ...config, cleanBuild: true })
  expect(events).toEqual(
    findSocketPatches(config.patchesReleaseDir, config.buildPatchesDir).flatMap(
      patch => [`validate:${patch.path}`, `apply:${patch.path}`],
    ),
  )
  expect(
    vi.mocked(shouldRun).mock.calls.every(call => call[3]?.force === true),
  ).toBe(true)
  expect(io.checkpoint.mock.calls[0]?.[3]).toMatchObject({
    artifactPath: config.modeSourceDir,
    patchCount: 3,
    tarExcludes: ['out'],
  })
})
test.each(['validation', 'application', 'output'])(
  'refuses %s failures without a successful checkpoint',
  async failure => {
    if (failure === 'validation') {
      vi.mocked(validatePatch).mockResolvedValue(false)
    }
    if (failure === 'application') {
      vi.mocked(applyPatch).mockRejectedValue(
        new Error('fixture patch application failure'),
      )
    }
    if (failure === 'output') {
      io.exists.mockImplementation(
        file => file !== config.patchedFile && !String(file).includes('absent'),
      )
    }
    await expect(applySocketPatches(config)).rejects.toThrow()
    expect(applyPatch).toHaveBeenCalledTimes(
      failure === 'validation' ? 0 : failure === 'application' ? 1 : 3,
    )
    expect(io.checkpoint).toHaveBeenCalledTimes(failure === 'output' ? 1 : 0)
  },
)
