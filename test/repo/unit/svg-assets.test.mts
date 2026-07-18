/**
 * @file Brand SVG size gate. Repository docs reference external SVG files, and
 *   every edited asset must be a fixpoint of the pinned SVGO pass.
 */

import { readFile } from 'node:fs/promises'

import { optimize } from 'svgo'
import { describe, expect, test } from 'vitest'

const fishPrintUrl = new URL(
  '../../../assets/repo/brand/sockeye-logomark.svg',
  import.meta.url,
)

describe('brand SVG assets', () => {
  test('keeps the fish print optimized', async () => {
    const source = await readFile(fishPrintUrl, 'utf8')
    const optimized = optimize(source, { multipass: true }).data
    expect(optimized.trimEnd()).toBe(source.trimEnd())
  })
})
