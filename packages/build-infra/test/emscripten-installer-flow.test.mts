import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  activateEmscripten,
  ensureEmscripten,
  installEmscripten,
} from '../lib/emscripten-installer.mts'
import { parseEmsdkEnvironment } from '../lib/emscripten-environment.mts'

vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))

let directory: string

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'example-emsdk-'))
  vi.resetAllMocks()
  vi.stubEnv('EMSDK', undefined)
  vi.stubEnv('EMSCRIPTEN', undefined)
  vi.stubEnv('EM_CONFIG', undefined)
  vi.stubEnv('PATH', process.env['PATH'])
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await safeDelete(directory)
})

function installedSdk() {
  writeFileSync(path.join(directory, 'emsdk'), '')
  return directory
}

function commands() {
  return vi
    .mocked(spawn)
    .mock.calls.map(call => ({ command: call[0], args: call[1] }))
}

function spawnResult(stdout = '') {
  return { code: 0, stdout, stderr: '', pid: 0 }
}

function spawnFailure() {
  return Object.assign(new Error('Fixture SDK process failure'), {
    code: 1,
    stdout: '',
    stderr: '',
  })
}

describe('Emscripten installer phases', () => {
  test('filters environment output and supplies critical SDK paths', () => {
    expect(
      parseEmsdkEnvironment(
        'PATH=/example/bin\nEM_CONFIG=config\nIGNORED=value\ninvalid\n',
        directory,
      ),
    ).toEqual({
      PATH: '/example/bin',
      EM_CONFIG: 'config',
      EMSDK: directory,
      EMSCRIPTEN: path.join(directory, 'upstream', 'emscripten'),
    })
  })

  test('activation applies only SDK environment variables', async () => {
    installedSdk()
    vi.mocked(spawn)
      .mockResolvedValueOnce(spawnResult())
      .mockResolvedValueOnce(
        spawnResult('EM_CONFIG=example-config\nIGNORED=value\n'),
      )
    const result = await activateEmscripten({
      emsdkPath: directory,
      quiet: true,
      version: '4.0.0',
    })
    expect(result.activated).toBe(true)
    expect(process.env['EM_CONFIG']).toBe('example-config')
    expect(process.env['EMSDK']).toBe(directory)
    expect(commands()[0]?.args).toEqual(['activate', '4.0.0'])
  })

  test('activation failure does not source or mutate the environment', async () => {
    installedSdk()
    vi.mocked(spawn).mockRejectedValueOnce(spawnFailure())
    expect(
      (await activateEmscripten({ emsdkPath: directory, quiet: true }))
        .activated,
    ).toBe(false)
    expect(commands()).toHaveLength(1)
    expect(process.env['EMSDK']).toBeUndefined()
  })

  test('source failure leaves activation and environment unchanged', async () => {
    installedSdk()
    vi.mocked(spawn)
      .mockResolvedValueOnce(spawnResult())
      .mockRejectedValueOnce(spawnFailure())
    expect(
      (await activateEmscripten({ emsdkPath: directory, quiet: true }))
        .activated,
    ).toBe(false)
    expect(process.env['EMSCRIPTEN']).toBeUndefined()
    expect(process.env['EMSDK']).toBeUndefined()
    expect(commands()).toHaveLength(2)
  })

  test('successful empty environment output supplies critical SDK fallbacks', async () => {
    installedSdk()
    vi.mocked(spawn).mockResolvedValue(spawnResult())
    const result = await activateEmscripten({
      emsdkPath: directory,
      quiet: true,
    })
    expect(result.activated).toBe(true)
    expect(process.env['EMSDK']).toBe(directory)
    expect(process.env['EMSCRIPTEN']).toBe(
      path.join(directory, 'upstream', 'emscripten'),
    )
  })

  test('an available compiler fills toolchain paths without installation', async () => {
    installedSdk()
    vi.mocked(whichSync).mockReturnValue('/example/emcc')
    expect(
      await ensureEmscripten({ installPath: directory, quiet: true }),
    ).toEqual({ activated: false, available: true, installed: false })
    expect(process.env['EMSDK']).toBe(directory)
    expect(commands()).toEqual([])
  })

  test('failed activation installs the requested version then retries once', async () => {
    installedSdk()
    vi.mocked(spawn)
      .mockRejectedValueOnce(spawnFailure())
      .mockResolvedValueOnce(spawnResult())
      .mockResolvedValueOnce(spawnResult())
      .mockResolvedValueOnce(spawnResult())
    expect(
      await ensureEmscripten({
        installPath: directory,
        quiet: true,
        version: '4.0.0',
      }),
    ).toEqual({ activated: true, available: true, installed: true })
    expect(
      commands()
        .slice(0, 3)
        .map(call => call.args),
    ).toEqual([
      ['activate', '4.0.0'],
      ['install', '4.0.0'],
      ['activate', '4.0.0'],
    ])
  })

  test('disabled installation leaves an absent SDK untouched', async () => {
    expect(
      await ensureEmscripten({
        installPath: directory,
        quiet: true,
        autoInstall: false,
      }),
    ).toEqual({ activated: false, available: false, installed: false })
    expect(commands()).toEqual([])
  })

  test.each([0, 1, 2])(
    'stops installation when phase %s fails',
    async phase => {
      vi.mocked(whichSync).mockReturnValue('/example/git')
      for (let index = 0; index < phase; index += 1) {
        vi.mocked(spawn).mockResolvedValueOnce(spawnResult())
      }
      vi.mocked(spawn).mockRejectedValueOnce(spawnFailure())
      expect(
        await installEmscripten({ installPath: directory, quiet: true }),
      ).toBe(false)
      expect(commands()).toHaveLength(phase + 1)
    },
  )

  test('installation clones, installs, and activates in order', async () => {
    vi.mocked(whichSync).mockReturnValue('/example/git')
    vi.mocked(spawn).mockResolvedValue(spawnResult())
    expect(
      await installEmscripten({
        installPath: directory,
        quiet: true,
        version: '4.0.0',
      }),
    ).toBe(true)
    expect(commands().map(call => call.args?.[0])).toEqual([
      'clone',
      'install',
      'activate',
    ])
  })

  test('available compiler resolves symlinks before inferring SDK root', async () => {
    const compilerDir = path.join(installedSdk(), 'upstream', 'emscripten')
    mkdirSync(compilerDir, { recursive: true })
    const compiler = path.join(compilerDir, 'emcc')
    writeFileSync(compiler, '')
    const link = path.join(directory, 'emcc-link')
    symlinkSync(compiler, link)
    vi.mocked(whichSync).mockReturnValue(link)
    await ensureEmscripten({
      installPath: path.join(directory, 'missing'),
      quiet: true,
    })
    expect(process.env['EMSCRIPTEN']).toBe(realpathSync(compilerDir))
    expect(process.env['EMSDK']).toBe(realpathSync(directory))
  })
})
