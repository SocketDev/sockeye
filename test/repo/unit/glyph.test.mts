import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import { REPO_GLYPH } from '../../../scripts/repo/gen/glyph.mts'
import {
  repoLogomarkSvg,
  repoLogomarkInverseSvg,
} from '../../../scripts/fleet/gen/glyph-render.mts'
import { optimiseSvg } from '../../../scripts/fleet/gen/svg/optimize.mts'

describe('repository glyph', () => {
  test('reproduces both committed SVG variants', () => {
    const regular = readFileSync(
      new URL('../../../assets/repo/logomark.svg', import.meta.url),
      'utf8',
    )
    const inverse = readFileSync(
      new URL('../../../assets/repo/logomark-inverse.svg', import.meta.url),
      'utf8',
    )
    expect(optimiseSvg(repoLogomarkSvg(REPO_GLYPH))).toBe(regular)
    expect(optimiseSvg(repoLogomarkInverseSvg(REPO_GLYPH))).toBe(inverse)
  })
})

test('artwork contains complete SVG paths', () => {
  for (const part of REPO_GLYPH.parts) {
    expect(part.paths.length).toBeGreaterThan(0)
    for (const artwork of part.paths) {
      expect(artwork).toMatch(/^[Mm]/u)
      expect(artwork).not.toMatch(/[^MmLlHhVvCcSsQqTtAaZz0-9\s.,+-]/u)
      expect(artwork).not.toMatch(/[,\-+.]$/u)
    }
  }
})

test('fish layers retain their absolute origins and eye counters', () => {
  expect(REPO_GLYPH.parts.length).toBeGreaterThan(1)
  const layers = REPO_GLYPH.parts.flatMap(part => part.paths)
  expect(layers.some(layer => (layer.match(/M/gu) ?? []).length > 1)).toBe(true)
  for (const layer of layers) {
    expect(layer).not.toMatch(/m/u)
    for (const origin of layer.matchAll(
      /M(?<horizontal>[\d.]+) (?<vertical>[\d.]+)/gu,
    )) {
      const horizontal = Number(origin.groups?.['horizontal'])
      const vertical = Number(origin.groups?.['vertical'])
      expect(horizontal).toBeGreaterThan(340)
      expect(horizontal).toBeLessThan(875)
      expect(vertical).toBeGreaterThan(160)
      expect(vertical).toBeLessThan(745)
    }
  }
})
