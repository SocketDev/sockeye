import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  getPinnedPackage,
  getPinnedPackages,
  getToolConfig,
  getToolPackageSpec,
  getToolVersion,
  loadAllTools,
  loadExternalToolsJson,
  loadPythonVersions,
} from '../lib/pinned-versions.mts'
let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'pinned-boundaries-'))
})
afterEach(async () => {
  await safeDelete(root)
})
function manifest(tools: Record<string, unknown>, target = root) {
  mkdirSync(target, { recursive: true })
  const file = path.join(target, 'build-requirements.json')
  writeFileSync(file, JSON.stringify({ tools }))
  return file
}

test('invalid, absent and circular manifests return only resolvable local tools', () => {
  expect(loadExternalToolsJson(path.join(root, 'missing.json'))).toEqual({})
  const file = manifest({ example: { version: '1.0.0' } })
  writeFileSync(file, '{')
  expect(loadExternalToolsJson(file)).toEqual({})
  writeFileSync(
    file,
    JSON.stringify({ extends: file, tools: { example: { version: '1.0.0' } } }),
  )
  expect(loadExternalToolsJson(file)).toEqual({ example: { version: '1.0.0' } })
})

test('checkpoint overrides supply Python pins and extras without leaking other tools', () => {
  manifest({
    'example-python': {
      packageManager: 'pip',
      version: '1.0.0',
      extras: ['feature'],
    },
    'example-system': { version: '3.0.0' },
  })
  manifest(
    {
      'example-python': {
        packageManager: 'pip',
        version: '2.0.0',
        extras: ['optimized'],
      },
    },
    path.join(root, 'scripts', 'binary-released', 'shared'),
  )
  const options = { packageRoot: root, checkpointName: 'binary-released' }
  expect(getPinnedPackage('example-python', options)).toBe(
    'example-python[optimized]==2.0.0',
  )
  expect(getPinnedPackages(['example-python'], options)).toEqual([
    'example-python[optimized]==2.0.0',
  ])
  expect(loadPythonVersions(options)).toEqual({
    PYTHON_VERSIONS: { 'example-python': '2.0.0' },
    PYTHON_PACKAGE_EXTRAS: { 'example-python': ['optimized'] },
  })
  expect(getToolVersion('example-system', options)).toBe('3.0.0')
  expect(getToolConfig('example-system', options)).toEqual({ version: '3.0.0' })
  expect(loadAllTools(options)['example-python']).toMatchObject({
    version: '2.0.0',
  })
})

test('unpinned and non-Python tools refuse Python install specs', () => {
  manifest({
    'example-system': { version: '1.0.0' },
    'example-unpinned': { packageManager: 'pip' },
  })
  const options = { packageRoot: root }
  expect(() => getPinnedPackage('example-system', options)).toThrow()
  expect(() => getPinnedPackage('example-unpinned', options)).toThrow()
  expect(getToolVersion('example-unpinned', options)).toBeUndefined()
  expect(getToolConfig('example-missing', options)).toBeUndefined()
  expect(
    getToolPackageSpec('example-missing', 'example-package', 'apt', options),
  ).toBe('example-package')
})

test('Python pins without extras produce plain package specifiers', () => {
  manifest({ 'example-python': { packageManager: 'pip', version: '1.2.3' } })
  expect(getPinnedPackage('example-python', { packageRoot: root })).toBe(
    'example-python==1.2.3',
  )
})

test('default loaders use the base tool configuration', () => {
  expect(loadAllTools()).toEqual(loadAllTools({}))
  expect(loadPythonVersions()).toEqual(loadPythonVersions({}))
})

test.each([
  ['apt', 'example-package=1.2.3*'],
  ['apk', 'example-package=1.2.3*'],
  ['dnf', 'example-package=1.2.3*'],
  ['yum', 'example-package=1.2.3*'],
  ['brew', 'example-package@1.2.3'],
  ['choco', 'example-package --version 1.2.3'],
  ['unknown', 'example-package'],
])('formats %s package specs from the consumer pin', (manager, expected) => {
  manifest({ 'example-tool': { version: '1.2.3' } })
  expect(
    getToolPackageSpec('example-tool', 'example-package', manager, {
      packageRoot: root,
    }),
  ).toBe(expected)
})
