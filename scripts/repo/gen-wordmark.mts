#!/usr/bin/env node
/*
 * @file Reproducible generator for the sockeye wordmark — CODE IS LAW.
 *   Re-derives `assets/repo/wordmark.svg` from the committed source raster
 *   `assets/repo/src/sockeye-wordmark.png` so the vector is a deterministic
 *   function of a checked-in input. Pipeline:
 *
 *   1. sharp — crop the "sockeye" band out of the source (excluding the shield
 *      above and the "by socket labs" tagline below), grayscale it, upscale 2x
 *      (lanczos3, so the threshold rides anti-aliased edges → smooth curves),
 *      and threshold into a dark-text-on-light mask.
 *   2. esm-potrace-wasm — trace the mask into the "sockeye" letterforms. Runs
 *      headless in Node (its Node branch needs require/__dirname on globalThis
 *      before the module evaluates).
 *   3. Frame — re-home the traced glyphs on `currentColor` (so the word adapts to
 *      light/dark), right-align the "by socket labs" tagline (thin "by", solid
 *      violet "socket", violet→white "labs"), following the wheelhouse palette.
 *   4. svgo — optimize, preserving the <style> block (the prefers-color-scheme
 *      rules can't be inlined) so the file stays an SVGO fixpoint.
 *
 *   Library: import { traceWordmark } from './gen-wordmark.mts'
 *   CLI: node scripts/repo/gen-wordmark.mts (writes assets/repo/wordmark.svg)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import sharp from 'sharp'
import { optimize } from 'svgo'

import { WORDMARK_SOURCE_PATH, WORDMARK_SVG_PATH } from './paths.mts'
import { isMainModule } from '../fleet/_shared/is-main-module.mts'

const logger = getDefaultLogger()

/**
 * The "sockeye" band within the source raster: excludes the shield above and
 * the "by socket labs" tagline below (both are added/handled separately).
 */
export const SOURCE_CROP = {
  left: 0,
  top: 900,
  width: 1254,
  height: 223,
} as const

/**
 * 2x upscale before thresholding, so potrace rides anti-aliased edges.
 */
const TRACE_UPSCALE = 2

/**
 * Luma cutoff: the sockeye letters are white-on-black; text → potrace
 * foreground.
 */
export const LUMA_THRESHOLD = 128

/**
 * Potrace knobs matching the reference trace (`--turdsize 4 --alphamax 0.6
 * --opttolerance 0.2`): alphamax 0.6 keeps the letterform terminals crisp (the
 * sharp "e" apertures + the clean y-tail cut) without jaggies.
 */
export const POTRACE_OPTIONS = {
  turdsize: 4,
  turnpolicy: 4,
  alphamax: 0.6,
  opticurve: 1,
  opttolerance: 0.2,
  pathonly: false,
  extractcolors: false,
} as const

// Layout in the trace's coordinate space (viewBox 0 0 2508 446). Measured content
// bbox of the traced glyphs: x 157..2352, y 0..438.
const CONTENT_L = 157
const CONTENT_R = 2352
const PAD = 16
const TAG_BASELINE = 596
const VIEWBOX_H = 636
const TAG_SIZE = 128

interface PotraceImage {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

interface PotraceModule {
  readonly init: () => Promise<void>
  readonly potrace: (
    image: PotraceImage,
    options: Readonly<Record<string, unknown>>,
  ) => Promise<string | string[]>
}

let cachedPotrace: PotraceModule['potrace'] | undefined

/**
 * Load esm-potrace-wasm headless. Its Node branch reads require/__filename/
 * __dirname as free variables at module-eval time; publish them on globalThis
 * first, then import dynamically so the shim runs before the module evaluates.
 */
async function loadPotrace(): Promise<PotraceModule['potrace']> {
  if (cachedPotrace) {
    return cachedPotrace
  }
  const globals = globalThis as unknown as Record<string, unknown>
  const here = fileURLToPath(import.meta.url)
  globals['require'] ??= createRequire(import.meta.url)
  globals['__filename'] ??= here
  globals['__dirname'] ??= path.dirname(here)
  // oxlint-disable-next-line socket/no-dynamic-import-outside-bundle -- globals must be published before esm-potrace-wasm evaluates; a hoisted static import would run first and throw.
  const mod = (await import('esm-potrace-wasm')) as unknown as PotraceModule
  await mod.init()
  cachedPotrace = mod.potrace
  return cachedPotrace
}

/**
 * Crop + grayscale + 2x-upscale the source, then threshold into an RGBA mask
 * where the letters are dark (potrace foreground) and the ground is light.
 */
async function buildMask(
  sourcePath: string,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const { data: gray, info } = await sharp(sourcePath)
    .extract({ ...SOURCE_CROP })
    .greyscale()
    .resize({ width: SOURCE_CROP.width * TRACE_UPSCALE, kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { channels, height, width } = info
  const pixelCount = width * height
  const data = new Uint8ClampedArray(pixelCount * 4)
  for (let i = 0; i < pixelCount; i += 1) {
    const value = (gray[i * channels] ?? 0) >= LUMA_THRESHOLD ? 0 : 255
    const offset = i * 4
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }
  return { data, width, height }
}

/**
 * Frame the traced glyphs into the final wordmark: the sockeye letterforms on
 * `currentColor` (adapts to light/dark) plus the right-aligned tagline.
 */
function frameSvg(tracedSvg: string, height: number): string {
  const group = tracedSvg.match(
    /<g transform="([^"]+)" fill="#000000" stroke="none">([\s\S]*)<\/g>/,
  )
  if (!group) {
    throw new Error(
      'gen-wordmark: unexpected potrace output (no traced group).',
    )
  }
  const body = group[2]!
  const shiftX = PAD - CONTENT_L
  const rightEdge = CONTENT_R + shiftX
  const width = rightEdge + PAD
  const labsX1 = rightEdge - 300
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${VIEWBOX_H}" ` +
    `role="img" aria-label="sockeye by socket labs">` +
    `<title>sockeye</title><desc>sockeye wordmark by socket labs</desc>` +
    `<defs>` +
    `<linearGradient id="labs-grad" gradientUnits="userSpaceOnUse" ` +
    `x1="${labsX1}" y1="0" x2="${rightEdge}" y2="0">` +
    `<stop offset="0" stop-color="#a98bff"/><stop offset="1" class="labs-end"/>` +
    `</linearGradient>` +
    `<style>.by{fill:#9b9b9b}.labs-end{stop-color:#6d28d9}` +
    `@media (prefers-color-scheme:dark){.by{fill:#5c5c5c}.labs-end{stop-color:#ffffff}}</style>` +
    `</defs>` +
    `<g transform="translate(${shiftX},${height}) scale(0.1,-0.1)" ` +
    `fill="currentColor" stroke="none">${body}</g>` +
    `<text x="${rightEdge}" y="${TAG_BASELINE}" text-anchor="end" ` +
    `font-family="'SF Pro Text','Helvetica Neue',Arial,sans-serif" ` +
    `font-size="${TAG_SIZE}" letter-spacing="1">` +
    `<tspan class="by" font-size="82" font-weight="300">by</tspan>` +
    `<tspan dx="30" fill="#966eff" font-weight="500">socket</tspan>` +
    `<tspan dx="34" fill="url(#labs-grad)" font-weight="800">labs</tspan>` +
    `</text></svg>`
  )
}

/**
 * SVGO with the <style> block preserved: the prefers-color-scheme rules can't
 * be inlined, so disable inlineStyles/minifyStyles and keep the viewBox.
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
 * Trace the committed source into the final, SVGO-optimized wordmark string.
 */
export async function traceWordmark(
  sourcePath: string = WORDMARK_SOURCE_PATH,
): Promise<string> {
  const mask = await buildMask(sourcePath)
  const potrace = await loadPotrace()
  const traced = await potrace(
    { data: mask.data, width: mask.width, height: mask.height },
    { ...POTRACE_OPTIONS },
  )
  if (typeof traced !== 'string') {
    throw new Error('gen-wordmark: potrace returned no SVG document.')
  }
  const framed = frameSvg(traced, mask.height)
  return `${optimizeSvg(framed).trimEnd()}\n`
}

/**
 * Regenerate `assets/repo/wordmark.svg` from the committed source raster.
 */
export async function generateWordmark(): Promise<{
  path: string
  bytes: number
}> {
  const svg = await traceWordmark()
  mkdirSync(path.dirname(WORDMARK_SVG_PATH), { recursive: true })
  writeFileSync(WORDMARK_SVG_PATH, svg)
  return { path: WORDMARK_SVG_PATH, bytes: Buffer.byteLength(svg) }
}

async function main(): Promise<void> {
  const { bytes, path: outPath } = await generateWordmark()
  logger.success(`Generated ${outPath} (${bytes} bytes).`)
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    logger.fail(`gen-wordmark failed: ${errorMessage(error)}`)
    process.exitCode = 1
  })
}
