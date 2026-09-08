/**
 * @file Brand SVG size gate. Repository docs reference external SVG files, and
 *   every edited asset must be a fixpoint of the pinned SVGO pass.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { optimiseSvg } from '../../../scripts/fleet/gen/svg-optimize.mts'
import { optimizeSvgAssets } from '../../../scripts/repo/optimize-svg.mts'
import { LOGOMARK_SVG_PATHS } from '../../../scripts/repo/paths.mts'

describe('brand SVG assets', () => {
  test.each(LOGOMARK_SVG_PATHS)('keeps glyph %s optimized', async target => {
    const source = await readFile(target, 'utf8')
    const optimized = optimiseSvg(source)
    expect(optimized.trimEnd()).toBe(source.trimEnd())
  })
})

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(root => rm(root, { recursive: true, force: true })),
  )
})

test('optimizes changed assets and preserves already optimized bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-svg-assets-'))
  temporaryRoots.push(root)
  const changed = path.join(root, 'unoptimized.svg')
  const unchanged = path.join(root, 'optimized.svg')
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg"><!-- removable --><rect width="10" height="10"/></svg>'
  const optimized = optimiseSvg(source)
  const preserved = `${optimized.trimEnd()}\n\n`
  await writeFile(changed, source)
  await writeFile(unchanged, preserved)

  await optimizeSvgAssets({ targets: [changed, unchanged] })

  expect(await readFile(changed, 'utf8')).toBe(optimized)
  expect(await readFile(changed, 'utf8')).not.toContain('removable')
  expect(await readFile(unchanged, 'utf8')).toBe(preserved)
})

test('rejects missing asset inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-svg-missing-'))
  temporaryRoots.push(root)
  await expect(
    optimizeSvgAssets({ targets: [path.join(root, 'missing.svg')] }),
  ).rejects.toMatchObject({ code: 'ENOENT' })
})
