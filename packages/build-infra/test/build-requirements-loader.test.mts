import { beforeEach, expect, test, vi } from 'vitest'
import {
  loadExternalTools,
  loadExternalToolsSync,
} from '../lib/build-requirements-loader.mts'
const io = vi.hoisted(() => ({ read: vi.fn(), readSync: vi.fn() }))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  io.readSync.mockImplementation(actual.readFileSync)
  return {
    ...actual,
    readFileSync: io.readSync,
    promises: { ...actual.promises, readFile: io.read },
  }
})
beforeEach(() => vi.resetAllMocks())

test('both loaders parse pinned tool metadata', async () => {
  const content = JSON.stringify({ node: '24.0.0', python: '3.12.0' })
  io.read.mockResolvedValue(content)
  io.readSync.mockReturnValue(content)
  expect(await loadExternalTools('/example/package')).toEqual({
    node: '24.0.0',
    python: '3.12.0',
  })
  expect(loadExternalToolsSync('/example/package')).toEqual({
    node: '24.0.0',
    python: '3.12.0',
  })
  expect(io.read).toHaveBeenCalledWith(
    '/example/package/build-requirements.json',
    'utf8',
  )
  expect(io.readSync).toHaveBeenCalledWith(
    '/example/package/build-requirements.json',
    'utf8',
  )
})

test('missing metadata is wrapped with the original filesystem cause', async () => {
  const failure = Object.assign(new Error('fixture missing requirements'), {
    code: 'ENOENT',
  })
  io.read.mockRejectedValue(failure)
  io.readSync.mockImplementation(() => {
    throw failure
  })
  await expect(loadExternalTools('/example/package')).rejects.toHaveProperty(
    'cause',
    failure,
  )
  try {
    loadExternalToolsSync('/example/package')
    expect.unreachable('missing requirements must throw')
  } catch (error) {
    expect(error).toHaveProperty('cause', failure)
  }
})

test('malformed JSON retains the syntax error as its cause', async () => {
  io.read.mockResolvedValue('{invalid')
  io.readSync.mockReturnValue('{invalid')
  await expect(loadExternalTools('/example/package')).rejects.toHaveProperty(
    'cause',
    expect.any(SyntaxError),
  )
  try {
    loadExternalToolsSync('/example/package')
    expect.unreachable('invalid JSON must throw')
  } catch (error) {
    expect(error).toHaveProperty('cause', expect.any(SyntaxError))
  }
})

test('other filesystem failures preserve their identity', async () => {
  const failure = Object.assign(new Error('fixture permission denied'), {
    code: 'EACCES',
  })
  io.read.mockRejectedValue(failure)
  io.readSync.mockImplementation(() => {
    throw failure
  })
  await expect(loadExternalTools('/example/package')).rejects.toBe(failure)
  expect(() => loadExternalToolsSync('/example/package')).toThrow(failure)
})
