import path from 'node:path'
import { getPythonCommand } from 'local-build-infra/lib/python-installer'
import { errorMessage } from 'local-build-infra/lib/error-utils'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { PYTHON_DIR } from './paths.mts'

const logger = getDefaultLogger()

/**
 * Run Python script and parse JSON output.
 */
export async function runPythonScript(scriptName, scriptArgs, options = {}) {
  const scriptPath = path.join(PYTHON_DIR, scriptName)

  const python3Path = await getPythonCommand()
  if (!python3Path) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  const result = await spawn(python3Path, [scriptPath, ...scriptArgs], {
    ...options,
  })

  if (result.code !== 0) {
    throw new Error(`Python script failed: ${result.stderr}`)
  }

  // Parse JSON output from Python script.
  if (!result.stdout || !result.stdout.trim()) {
    throw new Error(
      'Python script produced no output. Expected JSON lines on stdout.',
    )
  }
  const lines = result.stdout.split(/\r?\n/).filter(Boolean)
  const results = []

  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
    try {
      const parsedResult = JSON.parse(line)
      results.push(parsedResult)

      if (parsedResult.error) {
        throw new Error(parsedResult.error)
      }

      if (parsedResult.code && parsedResult.code !== 'complete') {
        logger.substep(`${parsedResult.code.replace(/_/g, ' ')}...`)
      }
    } catch (e) {
      if (errorMessage(e).startsWith('{')) {
        continue
      }
      throw e
    }
  }

  return results.length > 0 ? results[results.length - 1] : {}
}
