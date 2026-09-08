import { existsSync, readFileSync } from 'node:fs'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { validateBuildRequirements } from '../../../packages/build-infra/lib/build-requirements-schema.mts'
import {
  BUILD_REQUIREMENTS_PATTERNS,
  resolveRequirementReference,
} from '../../../packages/build-infra/lib/build-requirements/paths.mts'
import {
  namesFromExternalTools,
  unreviewedTelemetry,
} from '../../fleet/lib/telemetry-scan.mts'
import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'
import type { ScriptMeta } from '../../fleet/process/run-main.mts'

const logger = getDefaultLogger()

interface RequirementDocument {
  $schema?: string | undefined
  extends?: string | string[] | undefined
}

export interface RequirementIssue {
  file: string
  code: 'empty' | 'json' | 'schema' | 'reference' | 'cycle' | 'telemetry'
}

export function findBuildRequirements(repoRoot: string): string[] {
  return globSync(BUILD_REQUIREMENTS_PATTERNS, {
    cwd: repoRoot,
    absolute: true,
    ignore: [
      '**/node_modules/**',
      '**/build/**',
      '**/dist/**',
      '**/upstream/**',
      '**/submodules/**',
      '**/tmp/**',
      '**/vendor/**',
    ],
  }).toSorted()
}

function readRequirementDocument(config: {
  file: string
  issues: RequirementIssue[]
}): RequirementDocument | undefined {
  const { file, issues } = { __proto__: null, ...config } as typeof config
  let source: string
  let data: unknown
  try {
    source = readFileSync(file, 'utf8')
    data = JSON.parse(source)
  } catch {
    issues.push({ file, code: 'json' })
    return undefined
  }
  const result = validateBuildRequirements(data)
  if (!result.ok) {
    issues.push({ file, code: 'schema' })
    return undefined
  }
  if (unreviewedTelemetry(namesFromExternalTools(source)).length) {
    issues.push({ file, code: 'telemetry' })
  }
  return result.value
}

function visitRequirementDocument(config: {
  file: string
  issues: RequirementIssue[]
  visiting: Set<string>
  visited: Set<string>
}): void {
  const { file, issues, visiting, visited } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (visiting.has(file)) {
    issues.push({ file, code: 'cycle' })
    return
  }
  if (visited.has(file)) {
    return
  }
  visiting.add(file)
  const data = readRequirementDocument({ file, issues })
  if (data) {
    checkRequirementReferences({ file, data, issues, visiting, visited })
  }
  visiting.delete(file)
  visited.add(file)
}

function checkRequirementReferences(config: {
  file: string
  data: RequirementDocument
  issues: RequirementIssue[]
  visiting: Set<string>
  visited: Set<string>
}): void {
  const { file, data, issues, visiting, visited } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (
    !data.$schema ||
    !existsSync(
      resolveRequirementReference({
        manifestPath: file,
        reference: data.$schema,
      }),
    )
  ) {
    issues.push({ file, code: 'reference' })
  }
  const references =
    typeof data.extends === 'string' ? [data.extends] : (data.extends ?? [])
  for (const reference of references) {
    const target = resolveRequirementReference({
      manifestPath: file,
      reference,
    })
    if (!existsSync(target)) {
      issues.push({ file, code: 'reference' })
      continue
    }
    visitRequirementDocument({ file: target, issues, visiting, visited })
  }
}

export function checkBuildRequirements(repoRoot: string): RequirementIssue[] {
  const files = findBuildRequirements(repoRoot)
  if (!files.length) {
    return [{ file: repoRoot, code: 'empty' }]
  }
  const issues: RequirementIssue[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  for (const file of files) {
    visitRequirementDocument({ file, issues, visiting, visited })
  }
  return issues
}

export function runBuildRequirementsCheck(): number {
  const issues = checkBuildRequirements(REPO_ROOT)
  for (const issue of issues) {
    logger.fail(
      `Build requirement ${issue.code} at ${issue.file}. Expected valid requirement data and references. Fix the named manifest.`,
    )
  }
  return issues.length ? 1 : 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'Validate builder requirements, inheritance references, and telemetry declarations.',
  help: 'Usage: pnpm run check:build-requirements',
}

if (isMainModule(import.meta.url)) {
  runMain(runBuildRequirementsCheck, SCRIPT_META)
}
