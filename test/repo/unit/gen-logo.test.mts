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
    expect(svg).toMatch(/viewBox="\d+ \d+ \d+ \d+"/)

    // The vintage-badge palette: salmon red, dark banner, cream field.
    for (const color of ['#d72b1b', '#293434', '#f2ede3']) {
      expect(svg.toLowerCase()).toContain(color)
    }

    // Drawn paths (the badge is traced layered vectors).
    expect(svg).toMatch(/<path\b/)

    // Accessible metadata survives optimization.
    expect(svg).toContain('<title>Sockeye</title>')
    expect(svg).toContain('<desc>')
    expect(svg).toContain('aria-label=')

    // No embedded raster. The badge is opaque by design (cream field + dark
    // banner rect clipped to the shield), so it reads on light and dark.
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('base64')
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
