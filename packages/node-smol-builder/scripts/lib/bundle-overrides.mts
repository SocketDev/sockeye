import { promises as fs } from 'node:fs'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

export async function readBundleOverrides(
  overridesPath: string | undefined,
): Promise<
  { keep?: string[] | undefined; drop?: string[] | undefined } | undefined
> {
  if (!overridesPath) {
    return undefined
  }
  try {
    const pkg = JSON.parse(await fs.readFile(overridesPath, 'utf8'))
    if (!pkg?.smol) {
      return undefined
    }
    const overrides = {
      __proto__: null,
      keep: pkg.smol.keep,
      drop: pkg.smol.drop,
    }
    return overrides
  } catch (error) {
    logger.warn(`could not read overrides: ${errorMessage(error)}`)
    return undefined
  }
}
