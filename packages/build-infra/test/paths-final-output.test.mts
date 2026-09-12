import { expect, test } from 'vitest'
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
    expect(getFinalBinaryPath(root, mode, target, binary)).toBe(
      `${root}/build/${mode}/${target}/out/Final/${binary}`,
    )
    expect(getFinalOutputDir(`${root}/build/${mode}/${target}`)).toBe(
      `${root}/build/${mode}/${target}/out/Final`,
    )
  },
)
