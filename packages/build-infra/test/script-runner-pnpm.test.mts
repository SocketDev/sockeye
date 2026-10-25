/**
 * @file Tests for script-runner utilities. Validates pnpm script execution,
 *   command sequencing, and parallel execution.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import type * as BinWhich from '@socketsecurity/lib-stable/exe/path/which'
import type * as SpawnChild from '@socketsecurity/lib-stable/process/spawn/child'

import * as binModule from '@socketsecurity/lib-stable/exe/path/which'
import * as spawnModule from '@socketsecurity/lib-stable/process/spawn/child'

import { pnpm } from '../lib/script-runner.mts'

vi.mock<typeof BinWhich>(
  import('@socketsecurity/lib-stable/exe/path/which'),
  () => ({
    which: vi.fn(),
  }),
)

vi.mock<typeof SpawnChild>(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  () => ({
    spawn: vi.fn(),
  }),
)

vi.mock(
  import('@socketsecurity/lib-stable/logger/default'),
  // Partial logger surface — only the methods script-runner calls; same
  // as-never shape the fleet's other logger mocks use.
  () =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing a value whose shape is established by the call above; TypeScript cannot carry that proof through this boundary.
    ({
      getDefaultLogger: () => ({
        error: vi.fn(),
        log: vi.fn(),
        step: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      }),
    }) as never,
)

describe('script-runner', () => {
  let mockWhich: Mock
  let mockSpawn: Mock

  beforeEach(() => {
    vi.clearAllMocks()

    mockWhich = vi.mocked(binModule.which)
    mockSpawn = vi.mocked(spawnModule.spawn)

    // Default mock: pnpm is available
    mockWhich.mockResolvedValue('/usr/local/bin/pnpm')
  })

  describe('pnpm.install', () => {
    it('should run pnpm install with frozen lockfile', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.install()

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['install', '--frozen-lockfile'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should throw error if pnpm not found', async () => {
      mockWhich.mockResolvedValue(undefined)

      await expect(pnpm.install()).rejects.toThrow('pnpm not found in PATH')
    })
  })

  describe('pnpm.build', () => {
    it('should build all packages when no package name provided', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.build()

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['run', '-r', 'build'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should build specific package when name provided', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.build({ packageName: 'my-package' })

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['--filter', 'my-package', 'run', 'build'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should throw error if pnpm not found', async () => {
      mockWhich.mockResolvedValue(undefined)

      await expect(pnpm.build()).rejects.toThrow('pnpm not found in PATH')
    })
  })

  describe('pnpm.test', () => {
    it('should run tests in all packages when no package name provided', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.test()

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['run', '-r', 'test'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should run tests in specific package when name provided', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.test({ packageName: 'my-package' })

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['--filter', 'my-package', 'run', 'test'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should throw error if pnpm not found', async () => {
      mockWhich.mockResolvedValue(undefined)

      await expect(pnpm.test()).rejects.toThrow('pnpm not found in PATH')
    })
  })

  describe('integration scenarios', () => {
    it('should handle typical monorepo workflow', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      // Install dependencies
      await pnpm.install()

      // Build all packages
      await pnpm.build()

      // Run tests
      await pnpm.test()

      expect(mockSpawn).toHaveBeenCalledTimes(3)
    })

    it('should handle package-specific build and test', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.build({ packageName: 'onnxruntime-builder' })
      await pnpm.test({ packageName: 'onnxruntime-builder' })

      expect(mockSpawn).toHaveBeenCalledTimes(2)
      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        '/usr/local/bin/pnpm',
        ['--filter', 'onnxruntime-builder', 'run', 'build'],
        expect.anything(),
      )
      expect(mockSpawn).toHaveBeenNthCalledWith(
        2,
        '/usr/local/bin/pnpm',
        ['--filter', 'onnxruntime-builder', 'run', 'test'],
        expect.anything(),
      )
    })
  })
})
