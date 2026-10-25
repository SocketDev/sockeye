import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const io = vi.hoisted(() => ({
  exists: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  list: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  manifest: vi.fn(),
  editable: vi.fn(),
  main: false,
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
  readFileSync: io.read,
  writeFileSync: io.write,
  readdirSync: io.list,
  mkdirSync: io.mkdir,
}))
vi.mock(import('node:module'), async original => ({
  ...(await original()),
  findPackageJSON: io.manifest,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDeleteSync: io.remove,
}))
vi.mock(import('@socketsecurity/lib-stable/packages/read'), () => ({
  readPackageJson: io.editable,
}))
vi.mock(import('../../../../scripts/fleet/process/is-main-module.mts'), () => ({
  isMainModule: () => io.main,
}))

let previousExit: typeof process.exitCode
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  io.main = false
  previousExit = process.exitCode
  process.exitCode = 0
  io.manifest.mockReturnValue('/example/installed/package.json')
  io.exists.mockReturnValue(true)
  io.list.mockReturnValue(['example.js', 'notes.txt'])
  io.read.mockImplementation((filename: string) =>
    filename.endsWith('package.json')
      ? '{"name":"experimental-fast-webstreams","version":"0.0.19","type":"module"}'
      : 'export const answer = 42',
  )
  io.editable.mockImplementation(async () => {
    const content = {
      name: 'experimental-fast-webstreams',
      version: '0.0.19',
      type: 'module' as string | undefined,
    }
    return {
      content,
      update: (changes: { type: undefined }) => {
        content.type = changes.type
      },
    }
  })
})
afterEach(() => {
  process.exitCode = previousExit
})

async function loadSync() {
  return await import('../../scripts/vendor-fast-webstreams/sync.mts')
}

test('synchronizes JavaScript sources and deterministic package metadata', async () => {
  const { processSourceFiles } = await loadSync()
  expect(await processSourceFiles()).toBe(1)
  const writes = Object.fromEntries(
    io.write.mock.calls.map(([filename, content]) => [
      path.basename(filename),
      content,
    ]),
  )
  expect(writes['example.js']).toContain('exports.answer = answer')
  expect(writes['VERSION']).toBe(
    'Package: experimental-fast-webstreams\nVersion: 0.0.19\n',
  )
  expect(JSON.parse(writes['package.json'])).toEqual({
    name: 'experimental-fast-webstreams',
    version: '0.0.19',
  })
  expect(io.remove).toHaveBeenCalledOnce()
  expect(io.write).toHaveBeenCalledTimes(3)
})

test('missing installed manifest or source directory fails before deleting vendor output', async () => {
  const { processSourceFiles, resolveFastWebstreamsManifest } = await loadSync()
  io.manifest.mockReturnValue(undefined)
  expect(() => resolveFastWebstreamsManifest()).toThrow()
  io.manifest.mockReturnValue('/example/installed/package.json')
  io.exists.mockReturnValue(false)
  await expect(processSourceFiles()).rejects.toThrow()
  expect(io.remove).not.toHaveBeenCalled()
})

test.each(['invalid-json', 'unreadable-editable'])(
  'refuses %s package metadata',
  async scenario => {
    const { processSourceFiles } = await loadSync()
    io.list.mockReturnValue([])
    if (scenario === 'invalid-json') {
      io.read.mockReturnValue('{')
    } else {
      io.editable.mockResolvedValue(undefined)
    }
    await expect(processSourceFiles()).rejects.toThrow()
  },
)

test.each([true, false])(
  'entrypoint records successful=%s sync without real filesystem mutation',
  async successful => {
    io.main = true
    if (!successful) {
      io.read.mockReturnValue('{')
    }
    await loadSync()
    await vi.waitFor(() => {
      if (successful) {
        expect(io.write).toHaveBeenCalledTimes(3)
      } else {
        expect(process.exitCode).toBe(1)
      }
    })
    expect(process.exitCode).toBe(successful ? 0 : 1)
  },
)
