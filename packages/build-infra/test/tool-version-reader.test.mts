import { beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({
  load: vi.fn(),
  loadSync: vi.fn(),
  read: vi.fn(),
}))
vi.mock(import('../lib/build-requirements-loader.mts'), () => ({
  loadExternalTools: io.load,
  loadExternalToolsSync: io.loadSync,
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  readFileSync: io.read,
}))
vi.mock(import('../lib/constants.mts'), () => ({
  NODE_VERSION_FILE: '/example/.node-version',
  PACKAGE_ROOT: '/example/build-infra',
}))
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
})
async function reader() {
  return await import('../lib/tool-version-reader.mts')
}

test.each(['cmake', 'emscripten', 'example-tool'])(
  'loads the declared %s version from its consumer root',
  async name => {
    io.load.mockResolvedValue({ tools: { [name]: { version: '3.2.1' } } })
    const api = await reader()
    const version =
      name === 'cmake'
        ? await api.getCMakeVersion('/example/consumer')
        : name === 'emscripten'
          ? await api.getEmscriptenVersion('/example/consumer')
          : await api.getToolVersion('/example/consumer', name)
    expect(version).toBe('3.2.1')
    expect(io.load).toHaveBeenCalledExactlyOnceWith('/example/consumer')
  },
)

test.each(['cmake', 'emscripten', 'example-tool'])(
  'rejects absent %s configuration and missing version fields',
  async name => {
    const api = await reader()
    async function readVersion() {
      if (name === 'cmake') {
        return await api.getCMakeVersion('/example/consumer')
      }
      if (name === 'emscripten') {
        return await api.getEmscriptenVersion('/example/consumer')
      }
      return await api.getToolVersion('/example/consumer', name)
    }
    io.load.mockResolvedValue({})
    await expect(readVersion()).rejects.toThrow()
    io.load.mockResolvedValue({ tools: { [name]: {} } })
    await expect(readVersion()).rejects.toThrow()
  },
)

test('Python version memoization only caches a valid result', async () => {
  const api = await reader()
  io.loadSync.mockReturnValue({})
  expect(() => api.getMinPythonVersion()).toThrow()
  io.loadSync.mockReturnValue({ tools: { python: {} } })
  expect(() => api.getMinPythonVersion()).toThrow()
  io.loadSync.mockReturnValue({ tools: { python: { version: '3.12' } } })
  expect(api.getMinPythonVersion()).toBe('3.12')
  io.loadSync.mockReturnValue({ tools: { python: { version: '3.13' } } })
  expect(api.getMinPythonVersion()).toBe('3.12')
  expect(io.loadSync).toHaveBeenCalledTimes(3)
})

test('Node version trims the pin and memoizes successful reads', async () => {
  const api = await reader()
  io.read.mockReturnValue('26.0.0\n')
  expect(api.getNodeVersion()).toBe('26.0.0')
  io.read.mockReturnValue('27.0.0')
  expect(api.getNodeVersion()).toBe('26.0.0')
  expect(io.read).toHaveBeenCalledExactlyOnceWith(
    '/example/.node-version',
    'utf8',
  )
})

test.each(['ENOENT', 'EACCES', 'empty'])(
  'Node version rejects %s without caching failure',
  async code => {
    const api = await reader()
    if (code === 'empty') {
      io.read.mockReturnValue(' \n')
    } else {
      io.read.mockImplementation(() => {
        throw Object.assign(new Error('example read failure'), { code })
      })
    }
    expect(() => api.getNodeVersion()).toThrow()
    io.read.mockReturnValue('26.0.0')
    expect(api.getNodeVersion()).toBe('26.0.0')
  },
)
