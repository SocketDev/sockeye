import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({ latest: vi.fn(), write: vi.fn(), run: vi.fn() }))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    existsSync: () => false,
    promises: { ...actual.promises, writeFile: io.write },
  }
})
vi.mock(import('@socketsecurity/lib-stable/releases/github-listing'), () => ({
  getLatestRelease: io.latest,
}))
vi.mock(import('../../../scripts/fleet/process/main/run.mts'), () => ({
  runMain: io.run,
}))
const argv = process.argv
const exitCode = process.exitCode
beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  process.argv = [process.execPath, '/example/update-assets.mts']
  io.latest.mockResolvedValue(undefined)
})
afterEach(() => {
  process.argv = argv
  process.exitCode = exitCode
})

test('omitting a tool filter checks every configured release without writing absent releases', async () => {
  const { main } = await import('../scripts/update-release-assets.mts')
  await main()
  expect(io.latest.mock.calls.map(call => call[0])).toEqual([
    'lief-',
    'curl-',
    'stubs-',
    'binpress-',
    'binflate-',
    'binject-',
    'node-smol-',
    'ink-',
    'iocraft-',
    'onnxruntime-',
    'models-',
    'yoga-layout-',
    'opentui-',
  ])
  expect(io.write).not.toHaveBeenCalled()
})

test('direct invocation delegates execution to the standard script runner', async () => {
  process.argv[1] = new URL(
    '../scripts/update-release-assets.mts',
    import.meta.url,
  ).pathname
  const api = await import('../scripts/update-release-assets.mts')
  expect(io.run).toHaveBeenCalledExactlyOnceWith(api.main, api.SCRIPT_META)
  expect(io.latest).not.toHaveBeenCalled()
  expect(io.write).not.toHaveBeenCalled()
})
