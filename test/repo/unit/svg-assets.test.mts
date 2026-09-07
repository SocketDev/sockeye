/**
 * @file Brand SVG size gate. Repository docs reference external SVG files, and
 *   every edited asset must be a fixpoint of the pinned SVGO pass.
 */

import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'vitest'

import { optimiseSvg } from '../../../scripts/fleet/gen/svg-optimize.mts'
import { LOGOMARK_SVG_PATHS } from '../../../scripts/repo/paths.mts'

describe('brand SVG assets', () => {
  test.each(LOGOMARK_SVG_PATHS)('keeps glyph %s optimized', async target => {
    const source = await readFile(target, 'utf8')
    const optimized = optimiseSvg(source)
    expect(optimized.trimEnd()).toBe(source.trimEnd())
  })
})
