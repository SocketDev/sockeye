import path from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({ read: vi.fn(), exists: vi.fn(), warn: vi.fn() }))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  readFileSync: io.read,
  existsSync: io.exists,
}))
vi.mock(import('../lib/paths.mts'), () => ({
  BUILD_REQUIREMENTS_PACKAGE_ROOT: '/example/build-infra',
  getBuildRequirementsPath: (root: string) =>
    path.join(root, 'build-requirements.json'),
  getCheckpointRequirementsPath: (root: string, phase: string) =>
    path.join(root, 'scripts', phase, 'shared', 'build-requirements.json'),
  resolveRequirementReference: ({
    manifestPath,
    reference,
  }: {
    manifestPath: string
    reference: string
  }) => path.resolve(path.dirname(manifestPath), reference),
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ warn: io.warn, fail: vi.fn() }),
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  io.exists.mockReturnValue(true)
  io.read.mockReturnValue(
    JSON.stringify({
      tools: {
        'example-python': {
          packageManager: 'pip',
          version: '1.2.3',
          extras: ['fast'],
        },
        'example-system': { version: '4.0.0' },
        'example-unpinned': { packageManager: 'pip', extras: [] },
      },
    }),
  )
})
test('initial exported Python maps include only pinned pip tools and nonempty extras', async () => {
  const { PYTHON_VERSIONS, PYTHON_PACKAGE_EXTRAS, TOOL_VERSIONS } =
    await import('../lib/pinned-versions.mts')
  expect(PYTHON_VERSIONS).toEqual({ 'example-python': '1.2.3' })
  expect(PYTHON_PACKAGE_EXTRAS).toEqual({ 'example-python': ['fast'] })
  expect(TOOL_VERSIONS['example-system']).toEqual({ version: '4.0.0' })
})
test('reports schema diagnostics while retaining parsed tools', async () => {
  const { loadExternalToolsJson } = await import('../lib/pinned-versions.mts')
  io.warn.mockClear()
  io.read.mockReturnValue(
    JSON.stringify({ tools: { 'example-invalid': { version: 123 } } }),
  )
  expect(loadExternalToolsJson('/example/invalid.json')).toEqual({
    'example-invalid': { version: 123 },
  })
  expect(io.warn).toHaveBeenCalledWith(
    expect.stringContaining('example-invalid'),
  )
})
test('schema root diagnostics still return no tools for an empty document value', async () => {
  const { loadExternalToolsJson } = await import('../lib/pinned-versions.mts')
  io.warn.mockClear()
  io.read.mockReturnValue('42')
  expect(loadExternalToolsJson('/example/invalid-root.json')).toEqual({})
  expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('(root)'))
})
