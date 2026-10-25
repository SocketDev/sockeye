/**
 * PATH lookup that fails loud when the binary is missing.
 *
 * `which()` from lib-stable is tolerant — it returns `null` for a missing
 * binary. Build steps that cannot proceed without a tool need that surfaced
 * as an actionable error instead of a downstream spawn failure on a null
 * command.
 */

import { which } from '@socketsecurity/lib-stable/exe/path/which'

/**
 * Resolve a binary on PATH, throwing when it cannot be found.
 */
export async function whichRequired(binName: string): Promise<string> {
  const binPath = await which(binName)
  if (typeof binPath !== 'string') {
    throw new Error(
      `Required binary not found: '${binName}'. ` +
        'PATH lookup returned nothing; wanted an executable path. ' +
        `Install '${binName}' and re-run.`,
    )
  }
  return binPath
}
