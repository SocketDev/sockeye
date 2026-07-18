#!/usr/bin/env node
/*
 * @file Reproducible generator for the sockeye combination mark — CODE IS LAW.
 *   Composes the committed logomark + wordmark into `assets/repo/combomark.svg`:
 *   the shield-and-salmon rises behind the word like a rising sun — a SOLID
 *   signature-gradient crest above the letters that breaks into our 4x4 ordered
 *   (Bayer) dither where it drops behind the text, the shield planted lower and
 *   cropped flat at the word's baseline. Deterministic function of the two
 *   committed source SVGs (same bytes in, same SVG out).
 *
 *   Library: import { traceCombomark } from './gen-combomark.mts'
 *   CLI: node scripts/repo/gen-combomark.mts (writes assets/repo/combomark.svg)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { optimize } from 'svgo'

import {
  COMBOMARK_SVG_PATH,
  LOGOMARK_SVG_PATH,
  WORDMARK_SVG_PATH,
} from './paths.mts'
import { isMainModule } from '../fleet/_shared/is-main-module.mts'

const logger = getDefaultLogger()

// --- geometry (wordmark output space; see gen-wordmark.mts) ---
// wordmark canvas W = 2227; sockeye content x 16..2211, baseline 343, descender 438.
const WORD_W = 2227
const SOCK_L = 16
const SOCK_W = 2195
const SOCK_CENTER = SOCK_L + SOCK_W / 2
const BASELINE = 343
const DESC_BOTTOM = 438
const TAG_BOTTOM = 596
// shield-art bbox within the logomark's 1254 box: centered x 627.5, top y 119, height 1001.
const ART_CX = 627.5
const ART_TOP = 119
const ART_H_BOX = 1001
const MARGIN = 40

// composition knobs
const SHIELD_H = 1060 // XL — wide across the word
const DITHER_CELL = 26
const DITHER_DENSITY = 0.62
const DITHER_FULL = 0.95
const DITHER_OFF = 0.42
const SINK = 150 // how far the shield point drops below the baseline before the crop

// --- colours (wheelhouse docs/design/color.md signature gradient) ---
const GRAD_VIOLET = '#a98bff'
const GRAD_PINK = '#f05abe'
const GRAD_BLUE = '#358ff3'
const DITHER_HUE = '#966eff' // the guide "purple" chart hue (holds up as dither)

// 4x4 ordered Bayer matrix normalized to 0..1 thresholds (dither-kit).
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map(row => row.map(value => (value + 0.5) / 16))

const round = (value: number, digits: number): string =>
  String(Number(value.toFixed(digits)))

/**
 * A single-colour ordered-dither tile: every cell painted the dither hue, its
 * alpha toggled between a full and an "off" tier by the Bayer threshold (per
 * dither-kit — vary opacity, not shade, so it reads on light and dark).
 */
function ditherPattern(id: string): string {
  let rects = ''
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const lit = DITHER_DENSITY > BAYER[row]![col]!
      rects +=
        `<rect x="${col * DITHER_CELL}" y="${row * DITHER_CELL}" ` +
        `width="${DITHER_CELL}" height="${DITHER_CELL}" fill="${DITHER_HUE}" ` +
        `fill-opacity="${lit ? DITHER_FULL : DITHER_OFF}"/>`
    }
  }
  const size = DITHER_CELL * 4
  return (
    `<pattern id="${id}" width="${size}" height="${size}" ` +
    `patternUnits="userSpaceOnUse">${rects}</pattern>`
  )
}

/**
 * The wordmark's <defs> body (labs gradient + prefers-color-scheme style).
 */
function wordmarkDefs(wordmarkSvg: string): string {
  return wordmarkSvg.match(/<defs>([\s\S]*?)<\/defs>/)?.[1] ?? ''
}

/**
 * The wordmark's drawn body: the currentColor glyph group + the tagline text.
 */
function wordmarkBody(wordmarkSvg: string): string {
  return wordmarkSvg
    .replace(/[\s\S]*<\/defs>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/<desc>[\s\S]*?<\/desc>/g, '')
    .trim()
}

/**
 * The logomark's traced shield paths (the <path> elements, sans the fill
 * group).
 */
function shieldPaths(logomarkSvg: string): string {
  const group = logomarkSvg.match(/<g[^>]*>([\s\S]*)<\/g>/)
  if (!group) {
    throw new Error('gen-combomark: no traced group in the logomark.')
  }
  return group[1]!.trim()
}

/**
 * SVGO with the wordmark's <style> block preserved (prefers-color-scheme rules
 * can't be inlined), matching gen-wordmark's pass so the file is a fixpoint.
 */
function optimizeSvg(svg: string): string {
  return optimize(svg, {
    multipass: true,
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            inlineStyles: false,
            minifyStyles: false,
            removeViewBox: false,
          },
        },
      },
    ],
  }).data
}

/**
 * Compose the combomark from the two source SVG strings (pre-SVGO).
 */
export function composeCombomark(
  logomarkSvg: string,
  wordmarkSvg: string,
): string {
  const paths = shieldPaths(logomarkSvg)
  const defs = wordmarkDefs(wordmarkSvg)
  const body = wordmarkBody(wordmarkSvg)

  const scale = SHIELD_H / ART_H_BOX
  const a = 0.1 * scale
  const tx = SOCK_CENTER - ART_CX * scale
  const fMat = MARGIN + (1254 - ART_TOP) * scale
  const shieldMatrix =
    `matrix(${round(a, 6)} 0 0 ${round(-a, 6)} ` +
    `${round(tx, 3)} ${round(fMat, 3)})`

  // Shield planted lower: its point drops SINK below the baseline, then the whole
  // shield is cropped flat at the baseline (bottom of the word).
  const shieldPoint = MARGIN + SHIELD_H
  const baseline = Number((shieldPoint - SINK).toFixed(2))
  const dY = round(baseline - BASELINE, 3)
  const left = Number((222 * scale + tx).toFixed(2))
  const width = Number((811 * scale).toFixed(2))
  const rectH = round(baseline - MARGIN, 2)

  // Dither starts a little below the top of the K (ascender), transitions fast.
  const kTop = baseline - BASELINE
  const t0 = round(kTop + 18, 2)
  const t1 = round(kTop + 66, 2)

  const vbW = WORD_W
  const vbH = Math.ceil(
    Math.max(DESC_BOTTOM + Number(dY), TAG_BOTTOM + Number(dY)) + MARGIN,
  )
  const crestX2 = round(left + width, 2)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" ` +
    `role="img" aria-label="sockeye by socket labs">` +
    `<title>sockeye</title>` +
    `<desc>sockeye combination mark: the shield-and-salmon rising behind the ` +
    `word, a solid crest dissolving into dither where it goes behind the text.` +
    `</desc>` +
    `<defs>` +
    ditherPattern('dither') +
    defs +
    `<linearGradient id="crest" x1="${left}" y1="${MARGIN}" x2="${crestX2}" ` +
    `y2="${t0}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${GRAD_VIOLET}"/>` +
    `<stop offset="0.52" stop-color="${GRAD_PINK}"/>` +
    `<stop offset="1" stop-color="${GRAD_BLUE}"/></linearGradient>` +
    `<linearGradient id="hideBelow" x1="0" y1="${t0}" x2="0" y2="${t1}" ` +
    `gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity="1"/></linearGradient>` +
    `<linearGradient id="hideAbove" x1="0" y1="${t0}" x2="0" y2="${t1}" ` +
    `gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#000" stop-opacity="1"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>` +
    `<mask id="crestmask" maskUnits="userSpaceOnUse" x="0" y="0" ` +
    `width="${vbW}" height="${vbH}">` +
    `<g transform="${shieldMatrix}" fill="#fff" stroke="none">${paths}</g>` +
    `<rect x="${left}" y="${MARGIN}" width="${width}" height="${rectH}" ` +
    `fill="url(#hideBelow)"/></mask>` +
    `<mask id="dithmask" maskUnits="userSpaceOnUse" x="0" y="0" ` +
    `width="${vbW}" height="${vbH}">` +
    `<g transform="${shieldMatrix}" fill="#fff" stroke="none">${paths}</g>` +
    `<rect x="${left}" y="${MARGIN}" width="${width}" height="${rectH}" ` +
    `fill="url(#hideAbove)"/></mask>` +
    `</defs>` +
    `<rect x="${left}" y="${MARGIN}" width="${width}" height="${rectH}" ` +
    `fill="url(#crest)" mask="url(#crestmask)"/>` +
    `<rect x="${left}" y="${MARGIN}" width="${width}" height="${rectH}" ` +
    `fill="url(#dither)" mask="url(#dithmask)"/>` +
    `<g transform="translate(0,${dY})">${body}</g>` +
    `</svg>`
  )
}

/**
 * Read the committed logomark + wordmark and produce the optimized combomark.
 */
export function traceCombomark(): string {
  const logomarkSvg = readFileSync(LOGOMARK_SVG_PATH, 'utf8')
  const wordmarkSvg = readFileSync(WORDMARK_SVG_PATH, 'utf8')
  const composed = composeCombomark(logomarkSvg, wordmarkSvg)
  return `${optimizeSvg(composed).trimEnd()}\n`
}

/**
 * Regenerate `assets/repo/combomark.svg` from the committed logomark +
 * wordmark.
 */
export function generateCombomark(): { path: string; bytes: number } {
  const svg = traceCombomark()
  mkdirSync(path.dirname(COMBOMARK_SVG_PATH), { recursive: true })
  writeFileSync(COMBOMARK_SVG_PATH, svg)
  return { path: COMBOMARK_SVG_PATH, bytes: Buffer.byteLength(svg) }
}

function main(): void {
  const { bytes, path: outPath } = generateCombomark()
  logger.success(`Generated ${outPath} (${bytes} bytes).`)
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (error) {
    logger.fail(`gen-combomark failed: ${errorMessage(error)}`)
    process.exitCode = 1
  }
}
