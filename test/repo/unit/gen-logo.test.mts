/**
 * @file Contract for the reproducible favicon generator. Asserts the derived
 *   favicon is the canonical committed logomark vector (well-formed, correctly
 *   framed, an SVGO fixpoint) and byte-stable across runs so the committed
 *   assets and the generator never drift.
 */

import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'vitest'

import { deriveFavicon } from '../../../scripts/repo/gen-logo.mts'
import {
  FAVICON_SVG_PATH,
  LOGOMARK_SVG_PATH,
} from '../../../scripts/repo/paths.mts'

describe('gen-logo favicon generator', () => {
  test('derives a well-formed, correctly framed SVG', () => {
    const svg = deriveFavicon()

    // Vector root with a viewBox (svgo must not drop it).
    expect(svg).toMatch(/^<svg\b/)
    expect(svg).toContain('</svg>')
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)

    // Socket signature gradient (violet → pink → blue), all three stops.
    expect(svg).toContain('<linearGradient')
    const stops = svg.match(/<stop\b/g) ?? []
    expect(stops).toHaveLength(3)
    for (const color of ['#a98bff', '#f05abe', '#358ff3']) {
      expect(svg.toLowerCase()).toContain(color)
    }

    // At least one path, filled via the gradient (svgo may hoist the shared
    // fill onto the enclosing <g>, so match the reference anywhere and
    // confirm it resolves to a defined linearGradient id).
    expect(svg).toMatch(/<path\b/)
    const fillRef = svg.match(/fill="url\(#([^)]+)\)"/)
    expect(fillRef).not.toBeNull()
    expect(svg).toContain(`<linearGradient id="${fillRef![1]}"`)

    // Accessible metadata survives optimization.
    expect(svg).toContain('<title>Sockeye</title>')
    expect(svg).toContain('<desc>')
    expect(svg).toContain('aria-label=')

    // No embedded raster and no opaque background rectangle — transparent,
    // works on light and dark.
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('base64')
    expect(svg).not.toMatch(/<rect\b/)
  })

  test('is byte-stable across runs (deterministic)', () => {
    expect(deriveFavicon()).toBe(deriveFavicon())
  })

  test('is exactly the canonical committed logomark vector', async () => {
    expect(deriveFavicon()).toBe(await readFile(LOGOMARK_SVG_PATH, 'utf8'))
  })

  test('the committed favicon is the canonical square mark', async () => {
    expect(await readFile(FAVICON_SVG_PATH, 'utf8')).toBe(deriveFavicon())
  })
})
