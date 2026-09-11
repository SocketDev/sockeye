import { readFile, writeFile } from 'node:fs/promises'

import { optimiseSvg } from '../fleet/gen/svg-optimize.mts'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'
import { LOGOMARK_SVG_PATHS } from './paths.mts'

export async function optimizeSvgAssets(
  options: { targets?: readonly string[] | undefined } = {},
): Promise<void> {
  const { targets = LOGOMARK_SVG_PATHS } = options
  for (const target of targets) {
    const source = await readFile(target, 'utf8')
    const optimized = optimiseSvg(source)
    if (optimized.trimEnd() !== source.trimEnd()) {
      await writeFile(target, optimized)
    }
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'optimizes both repository glyph variants without changing gradient references',
  help: 'Usage: pnpm run optimize:svg',
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(optimizeSvgAssets, SCRIPT_META)
}
