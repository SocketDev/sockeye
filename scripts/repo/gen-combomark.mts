#!/usr/bin/env node
/*
 * @file Reproducible generator for the sockeye combination mark — CODE IS LAW.
 *   The badge is all-in-one (the crest carries SOCKEYE and SOCKET LABS inside
 *   the shield), so the combomark IS the committed logomark, re-emitted for
 *   every variant slot. The badge is opaque (cream field + dark banner), so
 *   light and dark are the same bytes. Deterministic function of the committed
 *   source SVG (same bytes in, same SVG out).
 *
 *   Library: import { traceCombomark } from './gen-combomark.mts'
 *   CLI: node scripts/repo/gen-combomark.mts (writes
 *   assets/repo/brand/sockeye-combomark.svg)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { optimize } from 'svgo'

import {
  COMBOMARK_DARK_SVG_PATH,
  COMBOMARK_LIGHT_SVG_PATH,
  COMBOMARK_SVG_PATH,
  LOGOMARK_SVG_PATH,
} from './paths.mts'
import { isMainModule } from '../fleet/_shared/is-main-module.mts'

const logger = getDefaultLogger()
type CombomarkMode = 'adaptive' | 'dark' | 'light'

/**
 * SVGO multipass, matching the committed logomark's pass so the emitted
 * combomark is a fixpoint too.
 */
function optimizeSvg(svg: string): string {
  return optimize(svg, { multipass: true }).data
}

/**
 * The combomark for any mode: the all-in-one badge logomark, verified to be a
 * drawable SVG. The badge is opaque, so every mode shares the same bytes.
 */
export function traceCombomark(mode: CombomarkMode = 'adaptive'): string {
  void mode
  const logomarkSvg = readFileSync(LOGOMARK_SVG_PATH, 'utf8')
  if (!logomarkSvg.includes('<svg') || !logomarkSvg.includes('<path')) {
    throw new Error(
      'gen-combomark: the committed logomark is not a drawable SVG.',
    )
  }
  return `${optimizeSvg(logomarkSvg).trimEnd()}\n`
}

/**
 * Regenerate `assets/repo/brand/sockeye-combomark.svg` (and the light/dark
 * slots) from the committed logomark.
 */
export function generateCombomark(): { path: string; bytes: number } {
  mkdirSync(path.dirname(COMBOMARK_SVG_PATH), { recursive: true })
  const variants: ReadonlyArray<readonly [string, CombomarkMode]> = [
    [COMBOMARK_SVG_PATH, 'adaptive'],
    [COMBOMARK_LIGHT_SVG_PATH, 'light'],
    [COMBOMARK_DARK_SVG_PATH, 'dark'],
  ]
  let bytes = 0
  for (const [outPath, mode] of variants) {
    const svg = traceCombomark(mode)
    writeFileSync(outPath, svg)
    if (outPath === COMBOMARK_SVG_PATH) {
      bytes = Buffer.byteLength(svg)
    }
  }
  return { path: COMBOMARK_SVG_PATH, bytes }
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
