/**
 * @file Contract for the reproducible wordmark generator. Asserts the traced
 *   SVG is well-formed, adaptive (currentColor + prefers-color-scheme), carries
 *   the tagline, has no baked raster, is byte-stable across runs, and that the
 *   committed asset never drifts from the generator (code is law).
 */

import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'vitest'

import { traceWordmark } from '../../../scripts/repo/gen-wordmark.mts'
import { WORDMARK_SVG_PATH } from '../../../scripts/repo/paths.mts'

describe('gen-wordmark generator', () => {
  test('produces a well-formed, adaptive, framed SVG', async () => {
    const svg = await traceWordmark()

    // Vector root with a viewBox (svgo must not drop it).
    expect(svg).toMatch(/^<svg\b/)
    expect(svg).toContain('</svg>')
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)

    // The word adapts to light/dark via currentColor; at least one traced path.
    expect(svg).toContain('fill="currentColor"')
    expect(svg).toMatch(/<path\b/)

    // "labs" gradient + the prefers-color-scheme style block survive optimization.
    expect(svg).toContain('<linearGradient')
    expect(svg).toContain('prefers-color-scheme')
    for (const color of ['#a98bff', '#966eff']) {
      expect(svg.toLowerCase()).toContain(color)
    }

    // Tagline text is present (not rasterized).
    expect(svg).toContain('<text')
    expect(svg).toContain('>by<')
    expect(svg).toContain('>socket<')
    expect(svg).toContain('>labs<')

    // Accessible metadata.
    expect(svg).toContain('<title>sockeye</title>')
    expect(svg).toContain('aria-label=')

    // No embedded raster.
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('base64')
  })

  test('is byte-stable across runs (deterministic)', async () => {
    const first = await traceWordmark()
    const second = await traceWordmark()
    expect(second).toBe(first)
  })

  test('the committed wordmark asset matches the generator (code is law)', async () => {
    const committed = await readFile(WORDMARK_SVG_PATH, 'utf8')
    const generated = await traceWordmark()
    expect(committed.trimEnd()).toBe(generated.trimEnd())
  })
})
