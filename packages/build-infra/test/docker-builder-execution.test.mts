import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import process from 'node:process'
import {
  getBuilderImageTag,
  getBuildStrategy,
  hasBuilderImage,
} from '../lib/local-build-setup.mts'
import {
  buildForTarget,
  buildWithDocker,
  cleanAppleDoubleFiles,
  getAllTargets,
  getBuildableTargets,
  getDockerPlatform,
  runInDocker,
  runInteractiveDocker,
  testBinaryForTarget,
} from '../lib/docker-builder.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('../../../scripts/fleet/paths.mts'), () => ({
  REPO_ROOT: '/example/workspace',
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), isDarwin: () => true }),
)
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: vi.fn(),
  promises: {
    ...(await original()).promises,
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}))
vi.mock(import('../lib/local-build-setup.mts'), async original => ({
  ...(await original()),
  getBuildStrategy: vi.fn(),
  getBuilderImageTag: vi.fn(),
  hasBuilderImage: vi.fn(),
}))
function processResult(
  config: {
    failure?: Error | undefined
    stdout?: string | undefined
    stderr?: string | undefined
  } = {},
) {
  const { failure, stdout = '', stderr = '' } = config
  return Object.assign(
    failure
      ? Promise.reject(failure)
      : Promise.resolve({ code: 0, stdout, stderr, pid: 0 }),
    { process: { stdout: new EventEmitter(), stderr: new EventEmitter() } },
  )
}
const build = {
  outputDir: '/example/artifacts',
  packageName: 'example-builder',
  target: 'linux-arm64-glibc',
}
beforeEach(() => {
  vi.resetAllMocks()
  io.spawn.mockImplementation(() => processResult())
  vi.mocked(getBuildStrategy).mockReturnValue('docker')
  vi.mocked(getBuilderImageTag).mockReturnValue('example/image:arm64')
  vi.mocked(hasBuilderImage).mockResolvedValue(true)
  vi.mocked(existsSync).mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())
test.each(['native', 'download'] as const)(
  'routes %s build requests to the supplied callback',
  async strategy => {
    vi.mocked(getBuildStrategy).mockReturnValue(strategy)
    expect(await buildForTarget(build)).toEqual({ ok: false, strategy })
    const callback = vi
      .fn()
      .mockResolvedValue({ ok: true, artifactPath: '/example/output' })
    const config = {
      ...build,
      buildMode: 'dev',
      force: true,
      [strategy === 'native' ? 'nativeBuild' : 'download']: callback,
    }
    expect(await buildForTarget(config)).toEqual({
      ok: true,
      artifactPath: '/example/output',
      strategy,
    })
    expect(callback).toHaveBeenCalledExactlyOnceWith(
      strategy === 'native'
        ? { ...build, buildMode: 'dev', force: true }
        : build,
    )
    expect(io.spawn).not.toHaveBeenCalled()
  },
)
test('refuses non-Linux builds and missing images before filesystem writes', async () => {
  expect(await buildWithDocker({ ...build, target: 'darwin-arm64' })).toEqual({
    ok: false,
  })
  expect(hasBuilderImage).not.toHaveBeenCalled()
  vi.mocked(hasBuilderImage).mockResolvedValue(false)
  expect(await buildWithDocker(build)).toEqual({ ok: false })
  expect(fs.mkdir).not.toHaveBeenCalled()
  expect(io.spawn).not.toHaveBeenCalled()
})
test.each(['example-builder', 'binpress'])(
  'builds %s with explicit modes and artifact paths',
  async packageName => {
    io.spawn.mockImplementation(command =>
      processResult({
        stdout: command === 'find' ? '/example/._source.cpp\n' : '',
      }),
    )
    const result = await buildForTarget({
      ...build,
      packageName,
      buildMode: 'dev',
      force: true,
    })
    expect(result).toMatchObject({ ok: true, strategy: 'docker' })
    expect(normalizePath(result.artifactPath)).toContain(
      `packages/${packageName}/build/dev/out/Final/${packageName}`,
    )
    expect(fs.mkdir).toHaveBeenCalledExactlyOnceWith(build.outputDir, {
      recursive: true,
    })
    const args = io.spawn.mock.calls.find(call => call[0] === 'docker')?.[1]
    expect(args).toContain('BUILD_MODE=dev')
    expect(args).toContain(
      `cd packages/${packageName} && pnpm run build -- --force`,
    )
    expect(args.includes('BUILD_TOOLS_FROM_SOURCE=true')).toBe(
      packageName === 'binpress',
    )
  },
)
test('reports successful builds without inventing a missing artifact path', async () => {
  vi.mocked(existsSync).mockReturnValue(false)
  expect(await buildWithDocker(build)).toEqual({ ok: true })
  expect(io.spawn.mock.calls.find(call => call[0] === 'docker')?.[1]).toContain(
    'BUILD_MODE=prod',
  )
})
test.each([true, false])(
  'persists build failure output, populated=%s',
  async populated => {
    const stdout = populated ? 'fixture compiler output' : ''
    const stderr = populated ? 'fixture compiler diagnostic' : ''
    io.spawn.mockImplementation(command =>
      processResult(
        command === 'docker'
          ? {
              failure: Object.assign(new Error('fixture compiler failure'), {
                code: 7,
                stdout,
                stderr,
              }),
            }
          : {},
      ),
    )
    expect(await buildWithDocker(build)).toEqual({ ok: false })
    expect(fs.writeFile).toHaveBeenCalledExactlyOnceWith(
      path.join(build.outputDir, 'docker-build-error.log'),
      `=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}`,
      'utf8',
    )
  },
)
test('counts deleted AppleDouble files and handles missing directories', async () => {
  io.spawn.mockImplementation(() =>
    processResult({ stdout: '/example/._first\r\n/example/._second\n' }),
  )
  expect(await cleanAppleDoubleFiles('/example/build')).toBe(2)
  expect(io.spawn.mock.calls[0]?.[1]).toEqual([
    '/example/build',
    '-name',
    '._*',
    '-type',
    'f',
    '-delete',
    '-print',
  ])
  io.spawn.mockImplementation(() =>
    processResult({ failure: new Error('fixture missing directory') }),
  )
  expect(await cleanAppleDoubleFiles('/example/build')).toBe(0)
})
test('streams child output while preserving captured output', async () => {
  const child = processResult({
    stdout: 'fixture output',
    stderr: 'fixture diagnostic',
  })
  io.spawn.mockReturnValue(child)
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  const running = runInDocker({
    image: 'example/image',
    command: ['example-command'],
  })
  child.process.stdout.emit('data', Buffer.from('fixture output'))
  child.process.stderr.emit('data', Buffer.from('fixture diagnostic'))
  expect(await running).toEqual({
    code: 0,
    stdout: 'fixture output',
    stderr: 'fixture diagnostic',
  })
  expect(stdout).toHaveBeenCalledWith(Buffer.from('fixture output'))
  expect(stderr).toHaveBeenCalledWith(Buffer.from('fixture diagnostic'))
})
test('normalizes failures without an exit code in both Docker modes', async () => {
  io.spawn.mockImplementation(() =>
    processResult({ failure: new Error('fixture spawn unavailable') }),
  )
  expect(
    await runInDocker({ image: 'example/image', command: ['example-command'] }),
  ).toEqual({ code: 1, stdout: '', stderr: '' })
  expect(await runInteractiveDocker(['run', 'example/image'])).toEqual({
    code: 1,
    stdout: '',
    stderr: '',
  })
})
test.each(['native', 'docker', 'download'] as const)(
  'tests artifacts using %s strategy',
  async strategy => {
    vi.mocked(getBuildStrategy).mockReturnValue(strategy)
    expect(
      await testBinaryForTarget('/example/output/binary', 'linux-arm64-glibc'),
    ).toBe(true)
    if (strategy === 'download') {
      expect(io.spawn).not.toHaveBeenCalled()
    } else {
      const args = io.spawn.mock.calls.at(-1)?.[1]
      expect(args).toContain('--version')
      if (strategy === 'docker') {
        expect(args).toContain('/example/output:/test:ro')
      }
      io.spawn.mockImplementation(() =>
        processResult({
          failure: Object.assign(new Error('fixture verification failure'), {
            code: 1,
          }),
        }),
      )
      expect(
        await testBinaryForTarget(
          '/example/output/binary',
          'linux-arm64-glibc',
        ),
      ).toBe(false)
    }
  },
)
test('refuses testing an unmapped Docker image without running a container', async () => {
  vi.mocked(getBuilderImageTag).mockReturnValue(undefined)
  expect(
    await testBinaryForTarget('/example/binary', 'linux-arm64-glibc'),
  ).toBe(false)
  expect(io.spawn).not.toHaveBeenCalled()
})
test('filters downloadable targets and maps both Docker architectures', () => {
  vi.mocked(getBuildStrategy).mockImplementation(target =>
    target.startsWith('linux')
      ? 'docker'
      : target === 'darwin-arm64'
        ? 'native'
        : 'download',
  )
  expect(getAllTargets()).toHaveLength(8)
  expect(getBuildableTargets()).toEqual([
    'linux-x64-glibc',
    'linux-arm64-glibc',
    'linux-x64-musl',
    'linux-arm64-musl',
    'darwin-arm64',
  ])
  expect(getDockerPlatform('linux-arm64-glibc')).toBe('linux/arm64')
  expect(getDockerPlatform('linux-x64-musl')).toBe('linux/amd64')
})
