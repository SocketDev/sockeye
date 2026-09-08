import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import {
  checkBuildRequirements,
  findBuildRequirements,
} from '../../../scripts/repo/check/build-requirements-are-valid.mts'
import {
  BUILD_REQUIREMENTS_SCHEMA_PATH,
  getBuildRequirementsPath,
  isBuildRequirementsPath,
  ML_BUILD_REQUIREMENTS_FILENAME,
} from '../../../packages/build-infra/lib/build-requirements/paths.mts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

async function requirementFixture(): Promise<{
  root: string
  file: string
  packageRoot: string
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-requirements-'))
  roots.push(root)
  const packageRoot = path.join(root, 'packages', 'example-builder')
  await mkdir(packageRoot, { recursive: true })
  return { root, file: getBuildRequirementsPath(packageRoot), packageRoot }
}

async function writeRequirement(options: {
  file: string
  data?: object | undefined
}): Promise<void> {
  await writeFile(
    options.file,
    JSON.stringify({
      $schema: BUILD_REQUIREMENTS_SCHEMA_PATH,
      tools: {},
      ...options.data,
    }),
  )
}

test('validates builder minima and versionless requirements without fabricated origins', async () => {
  const { root, file } = await requirementFixture()
  await writeRequirement({
    file,
    data: {
      tools: {
        cmake: { version: '3.30', description: 'Build generator' },
        git: { description: 'Source checkout' },
      },
    },
  })
  expect(checkBuildRequirements(root)).toEqual([])
  expect(findBuildRequirements(root)).toEqual([file])
})

test('discovers and validates inherited ML requirements', async () => {
  const { root, file, packageRoot } = await requirementFixture()
  const ml = path.join(packageRoot, ML_BUILD_REQUIREMENTS_FILENAME)
  await writeRequirement({
    file: ml,
    data: {
      tools: {
        example: { packageManager: 'pip', version: '1.2.3', extras: ['cpu'] },
      },
    },
  })
  await writeRequirement({
    file,
    data: { extends: ML_BUILD_REQUIREMENTS_FILENAME },
  })
  expect(findBuildRequirements(root)).toHaveLength(2)
  expect(checkBuildRequirements(root)).toEqual([])
  expect(isBuildRequirementsPath(ml)).toBe(true)
})

test.each([{ tools: { example: { version: 42 } } }, { extends: 42 }])(
  'rejects invalid requirement schema %j',
  async data => {
    const { root, file } = await requirementFixture()
    await writeRequirement({ file, data })
    expect(checkBuildRequirements(root)).toContainEqual({
      file,
      code: 'schema',
    })
  },
)

test('rejects malformed JSON and empty discovery', async () => {
  const { root, file } = await requirementFixture()
  expect(checkBuildRequirements(root)).toEqual([{ file: root, code: 'empty' }])
  await writeFile(file, '{')
  expect(checkBuildRequirements(root)).toEqual([{ file, code: 'json' }])
})

test('rejects unresolved schema and inheritance references', async () => {
  const { root, file } = await requirementFixture()
  await writeRequirement({
    file,
    data: { $schema: 'missing-schema.json', extends: 'missing-base.json' },
  })
  expect(checkBuildRequirements(root)).toEqual([
    { file, code: 'reference' },
    { file, code: 'reference' },
  ])
})

test('rejects inheritance cycles', async () => {
  const { root, file } = await requirementFixture()
  await writeRequirement({ file, data: { extends: file } })
  expect(checkBuildRequirements(root)).toEqual([{ file, code: 'cycle' }])
})

test('rejects unreviewed telemetry declarations in requirements', async () => {
  const { root, file } = await requirementFixture()
  await writeRequirement({
    file,
    data: { tools: { example: { purl: 'pkg:npm/mixpanel@1.0.0' } } },
  })
  expect(checkBuildRequirements(root)).toEqual([{ file, code: 'telemetry' }])
})
