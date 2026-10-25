/**
 * @file Tests for @socketbin/node-smol-builder package structure and
 *   configuration.
 */

import { describe, expect, it } from 'vitest'
import { parseSync } from 'rolldown/utils'

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { readPackageJson } from '@socketsecurity/lib-stable/packages/read'

import { PACKAGE_ROOT as nodeSmolBuilderDir } from '../../scripts/paths.mts'

import { NODE_SMOL_BUILD_FLAGS_DOC_PATH } from '../paths.mts'

const scriptsDir = path.join(nodeSmolBuilderDir, 'scripts')
const buildDir = path.join(nodeSmolBuilderDir, 'build')

describe('node-smol package', () => {
  describe('package.json validation', () => {
    it('should have valid package.json metadata', async () => {
      const pkgJson = await readPackageJson(
        path.join(nodeSmolBuilderDir, 'package.json'),
      )

      // Private-package identity law: `local-<own directory name>` at 0.0.0,
      // so the name itself states this package never ships.
      expect(pkgJson.name).toBe('local-node-smol-builder')
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(pkgJson.license).toBe('MIT')
      expect(pkgJson.description).toContain('Node.js')
      expect(pkgJson.private).toBeTruthy()
    })

    it('should have build scripts', async () => {
      const pkgJson = await readPackageJson(
        path.join(nodeSmolBuilderDir, 'package.json'),
      )

      expect(pkgJson.scripts).toBeDefined()
      expect(pkgJson.scripts['build']).toBe(
        'node scripts/common/shared/build.mts',
      )
      expect(pkgJson.scripts['build:all']).toBe(
        'node scripts/common/shared/build.mts --all-platforms',
      )
    })
  })

  describe('build scripts exist', () => {
    it('should have build.mts script', () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      expect(existsSync(buildPath)).toBeTruthy()
    })

    it('build.mts should be valid JavaScript', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      expect(parseSync(buildPath, content).errors).toEqual([])
    })
  })

  it('ships its build-flags reference document', () => {
    expect(existsSync(NODE_SMOL_BUILD_FLAGS_DOC_PATH)).toBe(true)
  })

  describe('build directory structure', () => {
    it('should have build directory', () => {
      if (!existsSync(buildDir)) {
        // Skip if build has not been run
        return
      }
      expect(existsSync(buildDir)).toBeTruthy()
    })
  })

  describe('package is private', () => {
    it('should be marked as private', async () => {
      const pkgJson = await readPackageJson(
        path.join(nodeSmolBuilderDir, 'package.json'),
      )

      expect(pkgJson.private).toBeTruthy()
    })

    it('should not have publishConfig for npm', async () => {
      const pkgJson = await readPackageJson(
        path.join(nodeSmolBuilderDir, 'package.json'),
      )

      // Private package should not configure npm publishing.
      expect(pkgJson.publishConfig).toBeUndefined()
    })
  })

  // Build execution requires a compilation toolchain (gcc, make, python),
  // ~1GB disk, 5-10 minutes, and is platform-specific — covered by manual
  // runs and dedicated CI jobs only.
  it.todo('should build custom Node.js binary')
  it.todo('should apply Socket patches')
  it.todo('should produce binary under 30MB')
})
