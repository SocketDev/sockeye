import { expect, test } from 'vitest'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import {
  builderPackageFromCallerPath,
  getFinalBinaryPath,
  getFinalOutputDir,
} from '../lib/paths.mts'
test('builder package resolution removes only the script directory', () => {
  expect(
    builderPackageFromCallerPath(
      '/example/repo/packages/example-builder/scripts/build.mts',
    ),
  ).toBe('/example/repo/packages/example-builder')
})
test.each([
  ['prod', 'win32-x64', 'example.exe'],
  ['dev', 'darwin-arm64', 'example'],
])(
  'final outputs keep build mode %s and target %s separate',
  (mode, target, binary) => {
    const root = '/example/repo/packages/example-builder'
    expect(
      normalizePath(getFinalBinaryPath(root, mode, target, binary))
        .split('/')
        .slice(-6),
    ).toEqual(['build', mode, target, 'out', 'Final', binary])
    expect(
      normalizePath(getFinalOutputDir('/example/platform-build'))
        .split('/')
        .slice(-3),
    ).toEqual(['platform-build', 'out', 'Final'])
  },
)
