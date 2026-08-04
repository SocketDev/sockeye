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

import { COMBOMARK_SVG_PATH, LOGOMARK_SVG_PATH } from './paths.mts'
import { isMainModule } from '../fleet/_shared/is-main-module.mts'

const logger = getDefaultLogger()
/**
 * SVGO multipass, matching the committed logomark's pass so the emitted
 * combomark is a fixpoint too.
 */
function optimizeSvg(svg: string): string {
  return optimize(svg, { multipass: true }).data
}

/**
 * The combomark: the all-in-one badge logomark, verified to be a drawable SVG.
 *
 * There is deliberately no light/dark axis. The badge is an opaque full-colour
 * illustration with no single-ink layer to invert, so a theme variant would be
 * the same bytes under another name — which is exactly what this generator used
 * to emit. A mark earns a theme split only when something in it disappears
 * against the opposite background.
 */
export function traceCombomark(): string {
  const logomarkSvg = readFileSync(LOGOMARK_SVG_PATH, 'utf8')
  if (!logomarkSvg.includes('<svg') || !logomarkSvg.includes('<path')) {
    throw new Error(
      'gen-combomark: the committed logomark is not a drawable SVG.',
    )
  }
  return `${optimizeSvg(logomarkSvg).trimEnd()}\n`
}

/**
 * Regenerate `assets/repo/brand/sockeye-combomark.svg` from the committed
 * logomark. One adaptive output, no theme slots.
 */
export function generateCombomark(): { path: string; bytes: number } {
  mkdirSync(path.dirname(COMBOMARK_SVG_PATH), { recursive: true })
  const svg = traceCombomark()
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
