import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { afterEach, expect, test, vi } from 'vitest'

import { installReleaseBundle } from '../../../../scripts/repo/setup-sockeye.mts'
import {
  RELEASE_BUNDLE_NAME,
  releaseBundlePaths,
} from '../../../../scripts/repo/release/bundle.mts'

vi.mock(
  '@socketsecurity/lib-stable/process/spawn/child',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('@socketsecurity/lib-stable/process/spawn/child')
    >()),
    spawn: vi.fn(),
  }),
)

afterEach(() => vi.resetAllMocks())

test.each([0, 1])(
  'keeps the bundle intact and replaces the CLI only after verification returns %s',
  async code => {
    const scratch = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sockeye-install-test-'),
    )
    try {
      const source = path.join(scratch, RELEASE_BUNDLE_NAME)
      const files = releaseBundlePaths(source)
      await fs.mkdir(path.dirname(files.binary), { recursive: true })
      await fs.writeFile(files.binary, 'example executable')
      await fs.writeFile(files.profile, 'example profile')
      await fs.writeFile(files.info, 'example plist')
      const destination = path.join(scratch, 'socket', 'bin', 'sockeye')
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, 'previous executable')
      vi.mocked(spawn).mockResolvedValue({
        cmd: 'pnpm',
        args: [],
        code,
        signal: null,
        stdout: '',
        stderr: '',
      })
      if (code === 0) {
        await installReleaseBundle(source, destination)
        expect((await fs.lstat(destination)).isSymbolicLink()).toBe(true)
        const executable = await fs.readlink(destination)
        const bundle = path.resolve(executable, '../../..')
        expect(
          await fs.readFile(releaseBundlePaths(bundle).profile, 'utf8'),
        ).toBe('example profile')
        expect(await fs.readFile(destination, 'utf8')).toBe(
          'example executable',
        )
      } else {
        await expect(
          installReleaseBundle(source, destination),
        ).rejects.toThrow()
        expect(await fs.readFile(destination, 'utf8')).toBe(
          'previous executable',
        )
      }
    } finally {
      await fs.rm(scratch, { recursive: true, force: true })
    }
  },
)
