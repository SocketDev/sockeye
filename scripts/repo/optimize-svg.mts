import { readFile, writeFile } from 'node:fs/promises'

import { optimize } from 'svgo'
import type { Config } from 'svgo'

import { isMainModule } from '../fleet/_shared/is-main-module.mts'
import { runMain } from '../fleet/_shared/run-main.mts'
import type { ScriptMeta } from '../fleet/_shared/run-main.mts'
import { LOGOMARK_SVG_PATHS } from './paths.mts'

export const GLYPH_SVGO_CONFIG: Config = {
  js2svg: { indent: 0, pretty: false },
  multipass: true,
  plugins: [
    'removeComments',
    'removeMetadata',
    'cleanupAttrs',
    'cleanupNumericValues',
    {
      name: 'convertPathData',
      params: {
        applyTransforms: false,
        floatPrecision: 2,
        // SVGO accepts false at runtime but omits it from this parameter type.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SVGO type omits its false switch
        makeArcs: false as unknown as { threshold: number; tolerance: number },
      },
    },
    'removeEmptyContainers',
  ],
}

async function main(): Promise<void> {
  for (const target of LOGOMARK_SVG_PATHS) {
    const source = await readFile(target, 'utf8')
    const optimized = optimize(source, GLYPH_SVGO_CONFIG).data
    if (optimized.trimEnd() !== source.trimEnd()) {
      await writeFile(target, optimized)
    }
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'optimizes both repository glyph variants without changing gradient references',
  help: 'Usage: pnpm run optimize:svg',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
