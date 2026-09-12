import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { expect, test } from 'vitest'
import {
  BUILD_ROOT,
  getBuildPaths,
  getBuildSourcePaths,
  getCumulativeBuildSourcePaths,
  getCumulativeHierarchicalPaths,
  getDefaultPlatformArch,
  getExistingPaths,
  getHierarchicalPaths,
  getSharedBuildPaths,
  PACKAGE_ROOT,
} from '../../scripts/paths.mts'

test.each(['darwin', 'win32'])(
  '%s binaries use the platform suffix throughout all stages',
  platform => {
    const build = getBuildPaths('prod', platform, `${platform}-x64`)
    const filename = platform === 'win32' ? 'node.exe' : 'node'
    expect(build.buildDir).toBe(
      path.join(BUILD_ROOT, 'prod', `${platform}-x64`),
    )
    expect(build.binaryName).toBe(filename)
    expect(
      [
        build.nodeBinary,
        build.outputCompressedBinary,
        build.outputFinalBinary,
        build.outputReleaseBinary,
        build.outputStrippedBinary,
      ].map(value => path.basename(value)),
    ).toEqual(Array(5).fill(filename))
    expect(
      new Set([
        build.outputCompressedBinary,
        build.outputFinalBinary,
        build.outputReleaseBinary,
        build.outputStrippedBinary,
      ]).size,
    ).toBe(4)
    expect(build.outputFinalBinary).toBe(
      path.join(build.outputFinalNodeDir, filename),
    )
    expect(() => getBuildPaths('prod')).toThrow(Error)
  },
)
test('cache paths layer shared before platform and architecture overrides', () => {
  const paths = getHierarchicalPaths(
    'patches',
    'binary-released',
    'linux',
    'arm64',
  )
  expect(paths.map(value => path.relative(PACKAGE_ROOT, value))).toEqual([
    'patches/binary-released/shared',
    'patches/binary-released/linux/shared',
    'patches/binary-released/linux/arm64',
  ])
  expect(
    getCumulativeHierarchicalPaths(
      'patches',
      ['binary-released', 'finalized'],
      'linux',
      'arm64',
    ).slice(0, 3),
  ).toEqual(paths)
  const current = getBuildSourcePaths('finalized', 'linux', 'arm64')
  const cumulative = getCumulativeBuildSourcePaths(
    'finalized',
    'linux',
    'arm64',
  )
  expect(cumulative.scripts.length).toBeGreaterThan(current.scripts.length)
  expect(cumulative.patches).toEqual(current.patches)
  expect(cumulative.additions).toEqual(current.additions)
  expect(cumulative.common).toEqual(current.common)
  expect(
    getCumulativeBuildSourcePaths('example-phase', 'linux', 'arm64'),
  ).toEqual(getBuildSourcePaths('example-phase', 'linux', 'arm64'))
})
test('shared source and existence filtering retain actual paths without inventing files', () => {
  const shared = getSharedBuildPaths()
  expect(shared.buildDir).toBe(path.join(BUILD_ROOT, 'shared'))
  expect(shared.configureScript).toBe(
    path.join(shared.nodeSourceDir, 'configure'),
  )
  const missing = path.join(PACKAGE_ROOT, 'example-deliberately-absent-file')
  expect(existsSync(missing)).toBe(false)
  expect(getExistingPaths([PACKAGE_ROOT, missing])).toEqual([PACKAGE_ROOT])
  expect(getDefaultPlatformArch('linux', 'x64', 'musl')).toBe('linux-x64-musl')
  expect(getDefaultPlatformArch()).toBe(
    getDefaultPlatformArch(process.platform, process.arch),
  )
})
