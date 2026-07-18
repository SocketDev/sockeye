/**
 * @file Contract for the reproducible combination-mark generator. Asserts the
 *   composed SVG is well-formed, adaptive (currentColor +
 *   prefers-color-scheme), carries the dither pattern + shield masks, has no
 *   baked raster, is stable across runs, and that the committed asset never
 *   drifts (code is law).
 */

import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'vitest'

import { traceCombomark } from '../../../scripts/repo/gen-combomark.mts'
import { COMBOMARK_SVG_PATH } from '../../../scripts/repo/paths.mts'

describe('gen-combomark generator', () => {
  test('produces a well-formed, adaptive combination mark', async () => {
    const svg = traceCombomark()

    // Vector root with a viewBox.
    expect(svg).toMatch(/^<svg\b/)
    expect(svg).toContain('</svg>')
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)

    // The rising shield: dither pattern + the two shield masks (crest + dither).
    expect(svg).toContain('<pattern')
    expect(svg).toMatch(/<mask\b/)
    expect(svg).toMatch(/mask="url\(#/)

    // Wordmark rides on currentColor and keeps the prefers-color-scheme style.
    expect(svg).toContain('fill="currentColor"')
    expect(svg).toContain('prefers-color-scheme')

    // Signature-gradient crest.
    for (const color of ['#a98bff', '#f05abe', '#358ff3']) {
      expect(svg.toLowerCase()).toContain(color)
    }

    // Tagline text present (not rasterized).
    expect(svg).toContain('>socket<')
    expect(svg).toContain('>labs<')

    // Accessible metadata; no embedded raster.
    expect(svg).toContain('<title>sockeye</title>')
    expect(svg).toContain('aria-label=')
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('base64')
  })

  test('is stable across runs (deterministic)', () => {
    expect(traceCombomark()).toBe(traceCombomark())
  })

  test('the committed combomark asset matches the generator (code is law)', async () => {
    const committed = await readFile(COMBOMARK_SVG_PATH, 'utf8')
    expect(committed.trimEnd()).toBe(traceCombomark().trimEnd())
  })
})
