/**
 * @file Brand SVG size gate. Repository docs reference external SVG files, and
 *   every edited asset must be a fixpoint of the pinned SVGO pass.
 */

import { readFile } from 'node:fs/promises'

import { optimize } from 'svgo'
import { describe, expect, test } from 'vitest'

import { GLYPH_SVGO_CONFIG } from '../../../scripts/repo/optimize-svg.mts'
import { LOGOMARK_SVG_PATHS } from '../../../scripts/repo/paths.mts'

describe('brand SVG assets', () => {
  test.each(LOGOMARK_SVG_PATHS)('keeps glyph %s optimized', async target => {
    const source = await readFile(target, 'utf8')
    const optimized = optimize(source, GLYPH_SVGO_CONFIG).data
    expect(optimized.trimEnd()).toBe(source.trimEnd())
  })
})
