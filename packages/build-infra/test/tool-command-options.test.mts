import { expect, test } from 'vitest'
import {
  createPinnedToolInstallCommand,
  createUnixToolInstallCommand,
} from '../lib/tool-install-command.mts'

test.each([
  ['apt', 'apt-get', ['install', '-y', 'example-tool']],
  ['apk', 'apk', ['add', '--no-cache', 'example-tool']],
  ['yum', 'yum', ['install', '-y', 'example-tool']],
  ['dnf', 'dnf', ['install', '-y', 'example-tool']],
])(
  'constructs an unpinned %s install with platform-specific elevation',
  (packageManager, binary, args) => {
    const config = { packageManager, packageName: 'example-tool' }
    expect(
      createPinnedToolInstallCommand({ ...config, platform: 'linux' }),
    ).toEqual({ command: 'sudo', args: [binary, ...args] })
    expect(
      createUnixToolInstallCommand({ ...config, platform: 'win32' }),
    ).toEqual({ command: binary, args })
  },
)

test.each([
  [undefined, false, ['install', 'example-tool']],
  [undefined, true, ['install', 'example-tool', '-y']],
  ['1.2.3', false, ['install', 'example-tool', '--version', '1.2.3']],
  ['1.2.3', true, ['install', 'example-tool', '--version', '1.2.3', '-y']],
])(
  'preserves Chocolatey version %s and confirmation %s',
  (version, autoYes, args) => {
    expect(
      createPinnedToolInstallCommand({
        packageManager: 'choco',
        packageName: 'example-tool',
        version,
        autoYes,
      }),
    ).toEqual({ command: 'choco', args })
  },
)

test.each(['brew', 'scoop'])(
  'supports unpinned %s installation',
  packageManager => {
    expect(
      createPinnedToolInstallCommand({
        packageManager,
        packageName: 'example-tool',
      }),
    ).toEqual({ command: packageManager, args: ['install', 'example-tool'] })
  },
)

test('rejects an unsupported Unix package manager', () => {
  expect(() =>
    createUnixToolInstallCommand({
      packageManager: 'unsupported',
      packageName: 'example-tool',
    }),
  ).toThrow()
})
