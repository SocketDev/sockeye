/**
 * @file Contract for the reproducible combination-mark generator. The badge is
 *   all-in-one, so the combomark is the committed logomark re-emitted: assert
 *   it is well-formed, carries the badge palette, has no baked raster, is
 *   stable across runs, and that the committed assets never drift (code is
 *   law).
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, test } from 'vitest'

import { traceCombomark } from '../../../scripts/repo/gen-combomark.mts'
import { COMBOMARK_SVG_PATH } from '../../../scripts/repo/paths.mts'

describe('gen-combomark generator', () => {
  test('produces a well-formed combination mark', async () => {
    const svg = traceCombomark()

    // Vector root with a viewBox.
    expect(svg).toMatch(/^<svg\b/)
    expect(svg).toContain('</svg>')
    expect(svg).toMatch(/viewBox="\d+ \d+ \d+ \d+"/)

    // Drawn paths (the badge is traced layered vectors).
    expect(svg).toMatch(/<path\b/)

    // Vintage-badge palette: salmon red, dark banner, cream field.
    for (const color of ['#d72b1b', '#293434', '#f2ede3']) {
      expect(svg.toLowerCase()).toContain(color)
    }

    // Accessible metadata; no embedded raster.
    expect(svg).toContain('<title>Sockeye</title>')
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

  test('ships ONE adaptive mark — no light/dark duplicates on disk', async () => {
    // The generator used to write the same bytes to three filenames, so
    // -light and -dark were copies of the adaptive file. An opaque full-colour
    // badge has no single-ink layer to invert, so a theme split would only
    // duplicate a filename. Guard the duplicates staying gone.
    const dir = path.dirname(COMBOMARK_SVG_PATH)
    const marks = (await readdir(dir)).filter(n => n.includes('combomark'))
    expect(marks).toEqual(['sockeye-combomark.svg'])
  })
})
