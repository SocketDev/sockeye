#!/usr/bin/env node
/*
 * @file Reproducible generator for the Sockeye favicon — CODE IS LAW.
 *   Derives `assets/repo/brand/sockeye-favicon.svg` from the canonical
 *   committed vector `assets/repo/brand/sockeye-logomark.svg` so the favicon
 *   is a deterministic function of a checked-in input (same source bytes in,
 *   same SVG bytes out). Pipeline:
 *
 *   1. Read the canonical logomark vector — the square shield + leaping salmon
 *      + fingerprint-ridge mark with its gradient, viewBox, and accessible
 *      <title>/<desc>/aria-label metadata.
 *   2. svgo — re-optimize with the repo-pinned multipass pass and assert the
 *      canonical vector is already an SVGO fixpoint (same bytes out), so the
 *      committed logomark can never drift from optimized form unnoticed.
 *   3. Write the favicon as those exact bytes — the favicon IS the canonical
 *      square mark (see test/repo/unit/gen-logo.test.mts).
 *
 *   Library: import { deriveFavicon } from './gen-logo.mts'
 *   CLI: node scripts/repo/gen-logo.mts (writes assets/repo/brand/sockeye-favicon.svg)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { optimize } from 'svgo'

import { isMainModule } from '../fleet/_shared/is-main-module.mts'
import { FAVICON_SVG_PATH, LOGOMARK_SVG_PATH } from './paths.mts'

const logger = getDefaultLogger()

/**
 * The favicon SVG: the canonical committed logomark vector, verified to be an
 * SVGO fixpoint. Throws LOUD when the canonical vector is missing or drifts
 * from optimized form — a silent re-optimize here would let the committed
 * logomark and every favicon consumer disagree about the bytes.
 */
export function deriveFavicon(): string {
  let canonical = ''
  try {
    canonical = readFileSync(LOGOMARK_SVG_PATH, 'utf8')
  } catch (e) {
    throw new Error(
      'gen-logo: cannot read the canonical logomark vector.\n' +
        `  Where: ${LOGOMARK_SVG_PATH}\n` +
        `  Saw: ${errorMessage(e)}; wanted the committed sockeye-logomark.svg.\n` +
        '  Fix: restore assets/repo/brand/sockeye-logomark.svg from git — it is the canonical brand source.',
    )
  }
  const optimized = `${optimize(canonical, { multipass: true }).data.trimEnd()}\n`
  if (optimized !== canonical) {
    throw new Error(
      'gen-logo: the canonical logomark vector is not an SVGO fixpoint.\n' +
        `  Where: ${LOGOMARK_SVG_PATH}\n` +
        '  Saw: re-optimizing changed the bytes; wanted a byte-stable multipass fixpoint.\n' +
        '  Fix: commit the optimized form (write the svgo multipass output back to the file), then re-run.',
    )
  }
  return optimized
}

/**
 * Write the favicon derived from the canonical logomark.
 * Returns the written path and its byte length.
 */
export function generateFavicon(): { path: string; bytes: number } {
  const svg = deriveFavicon()
  mkdirSync(path.dirname(FAVICON_SVG_PATH), { recursive: true })
  writeFileSync(FAVICON_SVG_PATH, svg)
  return { path: FAVICON_SVG_PATH, bytes: Buffer.byteLength(svg) }
}

function main(): void {
  const favicon = generateFavicon()
  logger.success(`Generated ${favicon.path} (${favicon.bytes} bytes).`)
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (e) {
    logger.fail(`gen-logo failed: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}
