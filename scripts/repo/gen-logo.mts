#!/usr/bin/env node
/*
 * @file Reproducible generator for the Sockeye brand mark — CODE IS LAW.
 *   Re-derives `assets/repo/brand/sockeye-logomark.svg` from the committed source raster
 *   `assets/repo/brand/sockeye-logomark.png` so the vector is a deterministic
 *   function of a checked-in input (same source bytes in, same SVG bytes out).
 *   Pipeline:
 *
 *   1. sharp — read the BLUE channel of the full icon-only frame (the clean
 *      discriminator: the mark is B≈255, the background B≈0 — luminance is too
 *      dim), and threshold it into a black-mark-on-white mask. The source is
 *      already icon-only (shield + leaping salmon + fingerprint ridges, no
 *      wordmark), so there is no region to crop out.
 *   2. esm-potrace-wasm — trace the mask into one B&W vector shape. Runs headless
 *      in Node: its Node branch needs `require`/`__dirname` as free variables,
 *      published on globalThis before the module evaluates.
 *   3. Recolor + frame — wrap the traced paths in a vertical azure→blue gradient,
 *      a square viewBox, and accessible <title>/<desc>/aria-label, over a
 *      transparent background (no baked raster, no opaque rect).
 *   4. svgo — optimize with the repo-pinned multipass pass so the written file is
 *      an SVGO fixpoint (see test/repo/unit/svg-assets.test.mts). Library:
 *      import { traceBrandMark } from './gen-logo.mts' CLI: node
 *      scripts/repo/gen-logo.mts (writes assets/repo/brand/sockeye-logomark.svg)
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

import {
  BRAND_SOURCE_PATH,
  FAVICON_SVG_PATH,
  LOGOMARK_SVG_PATH,
} from './paths.mts'
import { isMainModule } from '../fleet/_shared/is-main-module.mts'

const logger = getDefaultLogger()

/**
 * Blue-channel cutoff: pixels at/above this are the mark. The channel is
 * strongly bimodal (mark ≈255, background ≈0) with a faint anti-aliased edge in
 * between. 72 ≈ 28% of 255, matching the reference trace's `-threshold 28%`; it
 * keeps the solid mark plus its anti-aliased rim so the ridges stay continuous,
 * while turdsize drops the sub-mark specks.
 */
export const BLUE_THRESHOLD = 72

/**
 * Potrace B&W knobs, matching the reference trace (`--turdsize 6 --alphamax 1
 * --opttolerance 0.2`). `extractcolors:false` yields a single shape we recolor
 * ourselves; `pathonly:false` returns a full SVG document to reframe.
 */
export const POTRACE_OPTIONS = {
  turdsize: 6,
  turnpolicy: 4,
  alphamax: 1,
  opticurve: 1,
  opttolerance: 0.2,
  pathonly: false,
  extractcolors: false,
} as const

/**
 * Socket's signature gradient (wheelhouse docs/design/color.md): violet → pink
 * → blue, drawn on the 135° top-left→bottom-right diagonal for a square mark.
 */
export const GRADIENT_STOPS: ReadonlyArray<readonly [string, string]> = [
  ['0', '#A98BFF'],
  ['.52', '#F05ABE'],
  ['1', '#358FF3'],
]

const GRADIENT_ID = 'sockeye-grad'
const ARIA_LABEL = 'A leaping sockeye salmon inside a shield'
const DESC =
  'A leaping sockeye salmon inside a heraldic shield, ringed by ' +
  'water-ripple arcs, drawn in the Socket violet-pink-blue gradient.'

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
 * Load esm-potrace-wasm headless and return its (initialized) `potrace`. The
 * library's Node branch reads `require`/`__filename`/`__dirname` as free
 * variables at module-eval time; ESM scope has none, so publish them on
 * globalThis first. The import must be dynamic — a static import would hoist
 * above this shim and throw a ReferenceError as the module evaluates.
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
 * Blue-threshold the full source raster into an RGBA mask where the mark is
 * dark (potrace foreground) and the background light. The source is icon-only,
 * so the whole frame is traced (no crop) and the square viewBox is preserved.
 */
async function buildMask(
  sourcePath: string,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const { data: blue, info } = await sharp(sourcePath)
    .extractChannel('blue')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const pixelCount = width * height
  const data = new Uint8ClampedArray(pixelCount * 4)
  for (let i = 0; i < pixelCount; i += 1) {
    const value = (blue[i] ?? 0) >= BLUE_THRESHOLD ? 0 : 255
    const offset = i * 4
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }
  return { data, width, height }
}

/**
 * Reframe a raw potrace document into the final branded SVG: the traced group
 * kept intact (transform + paths) but refilled with our gradient, wrapped in a
 * transparent square viewBox with accessible metadata.
 */
function frameSvg(tracedSvg: string, width: number, height: number): string {
  // Potrace emits exactly one filled group:
  //   <g transform="…" fill="#000000" stroke="none">…paths…</g>
  // Capture its transform and inner path body so we can re-home them.
  const group = tracedSvg.match(
    /<g transform="([^"]+)" fill="#000000" stroke="none">([\s\S]*)<\/g>/,
  )
  if (!group) {
    throw new Error('gen-logo: unexpected potrace output (no traced group).')
  }
  const transform = group[1]!
  const body = group[2]!
  // Potrace's transform is `translate(tx,ty) scale(sx,sy)` with sy<0 (Y flip)
  // and sx<1 (downscale). The gradient uses userSpaceOnUse, which resolves in
  // this inner path space, so derive the extent from the parsed scale instead
  // of hard-coding potrace's factor; the flip puts the visual top at the far
  // inner-Y edge.
  const scale = transform.match(/scale\(([-\d.]+),([-\d.]+)\)/)
  if (!scale) {
    throw new Error('gen-logo: unexpected potrace transform (no scale).')
  }
  const scaleX = Math.abs(Number(scale[1]))
  const scaleY = Number(scale[2])
  const innerWidth = width / scaleX
  const innerHeight = height / Math.abs(scaleY)
  // Diagonal (top-left → bottom-right) for the 135° square-mark gradient. The
  // potrace Y flip (scaleY<0) puts the visual top at the far inner-Y edge.
  const topY = scaleY < 0 ? innerHeight : 0
  const bottomY = scaleY < 0 ? 0 : innerHeight
  const stops = GRADIENT_STOPS.map(
    ([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`,
  ).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `role="img" aria-label="${ARIA_LABEL}">` +
    `<title>Sockeye</title><desc>${DESC}</desc>` +
    `<defs><linearGradient id="${GRADIENT_ID}" gradientUnits="userSpaceOnUse" ` +
    `x1="0" y1="${topY}" x2="${innerWidth}" y2="${bottomY}">` +
    `${stops}</linearGradient></defs>` +
    `<g transform="${transform}" fill="url(#${GRADIENT_ID})" stroke="none">` +
    `${body}</g></svg>`
  )
}

/**
 * Trace the committed brand raster into the final, SVGO-optimized SVG string.
 * Pure with respect to the filesystem beyond reading `sourcePath`; the write is
 * left to `generateFishPrint` so tests can assert determinism without disk I/O.
 */
export async function traceBrandMark(
  sourcePath: string = BRAND_SOURCE_PATH,
): Promise<string> {
  const mask = await buildMask(sourcePath)
  const potrace = await loadPotrace()
  const traced = await potrace(
    { data: mask.data, width: mask.width, height: mask.height },
    { ...POTRACE_OPTIONS },
  )
  if (typeof traced !== 'string') {
    throw new Error('gen-logo: potrace returned no SVG document.')
  }
  const framed = frameSvg(traced, mask.width, mask.height)
  return `${optimize(framed, { multipass: true }).data.trimEnd()}\n`
}

/**
 * Regenerate `assets/repo/brand/sockeye-logomark.svg` from the committed source
 * raster.
 * Returns the written path and its byte length.
 */
export async function generateFishPrint(): Promise<{
  path: string
  bytes: number
}> {
  const svg = await traceBrandMark()
  mkdirSync(path.dirname(LOGOMARK_SVG_PATH), { recursive: true })
  writeFileSync(LOGOMARK_SVG_PATH, svg)
  return { path: LOGOMARK_SVG_PATH, bytes: Buffer.byteLength(svg) }
}

/**
 * Regenerate the square favicon from the canonical logomark vector.
 */
export async function generateFavicon(): Promise<{
  path: string
  bytes: number
}> {
  const svg = await traceBrandMark()
  mkdirSync(path.dirname(FAVICON_SVG_PATH), { recursive: true })
  writeFileSync(FAVICON_SVG_PATH, svg)
  return { path: FAVICON_SVG_PATH, bytes: Buffer.byteLength(svg) }
}

async function main(): Promise<void> {
  const [logomark, favicon] = await Promise.all([
    generateFishPrint(),
    generateFavicon(),
  ])
  logger.success(
    `Generated ${logomark.path} (${logomark.bytes} bytes) and ${favicon.path} (${favicon.bytes} bytes).`,
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    logger.fail(`gen-logo failed: ${errorMessage(error)}`)
    process.exitCode = 1
  })
}
