import { beforeEach, expect, test, vi } from 'vitest'
import { getDockerRunArgs, runInDocker } from '../lib/docker-builder.mts'

const docker = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: docker.spawn,
  }),
)
beforeEach(() => {
  docker.spawn.mockReset().mockResolvedValue({ code: 0 })
})
test('preserves default Docker arguments and command ordering', () => {
  expect(
    getDockerRunArgs({
      image: 'example-image',
      command: ['example-command', '--help'],
    }),
  ).toEqual([
    'run',
    '--rm',
    '-w',
    '/workspace',
    'example-image',
    'example-command',
    '--help',
  ])
})
test('preserves platform, environment, mounts, and interactive mode', () => {
  expect(
    getDockerRunArgs({
      image: 'example-image',
      command: ['example-command'],
      platform: 'linux/arm64',
      workdir: '/example-workdir',
      env: { EXAMPLE_COUNT: 3 },
      volumes: ['/example-source:/example-target'],
      interactive: true,
    }),
  ).toEqual([
    'run',
    '--rm',
    '--platform',
    'linux/arm64',
    '-w',
    '/example-workdir',
    '-e',
    'EXAMPLE_COUNT=3',
    '-v',
    '/example-source:/example-target',
    '-it',
    'example-image',
    'example-command',
  ])
})
test('normalizes successful interactive output', async () => {
  expect(
    await runInDocker({
      image: 'example-image',
      command: ['example-command'],
      interactive: true,
    }),
  ).toEqual({ code: 0, stderr: '', stdout: '' })
})
test('preserves interactive failure exit codes', async () => {
  docker.spawn.mockRejectedValueOnce(
    Object.assign(new Error('example failure'), { code: 7 }),
  )
  expect(
    await runInDocker({
      image: 'example-image',
      command: ['example-command'],
      interactive: true,
    }),
  ).toEqual({ code: 7, stderr: '', stdout: '' })
})
