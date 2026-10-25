import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  executeNativeCoverage,
  prepareNativeCoverage,
  reportNativeCoverage,
} from '../../../scripts/repo/cover-cpp.mts'
import {
  NATIVE_COVERAGE_ROOTS,
  NATIVE_COVERAGE_TESTS,
} from '../../../scripts/repo/native-coverage.mts'
import {
  getNativeCoverageReceiptPath,
  getNativeProfilePattern,
  REPO_ROOT,
} from '../../../scripts/repo/paths.mts'

const boundary = vi.hoisted(() => ({
  spawn: vi.fn(),
  tools: vi.fn(),
  create: vi.fn(),
  parse: vi.fn(),
  export: vi.fn(),
  stdout: vi.fn(),
}))
vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: boundary.spawn,
}))
vi.mock('../../../scripts/fleet/cover/llvm-toolchain.mts', () => ({
  ensureLlvmCoverageTools: boundary.tools,
}))
vi.mock('../../../scripts/fleet/cover/llvm-manifest.mts', () => ({
  createLlvmCoverageManifest: boundary.create,
  parseLlvmCoverageManifest: boundary.parse,
}))
vi.mock('../../../scripts/fleet/cover/llvm-report.mts', () => ({
  exportLlvmCoverage: boundary.export,
}))
vi.mock('../../../scripts/fleet/process/script-output.mts', () => ({
  getScriptArgs: () => [],
  writeScriptStdout: boundary.stdout,
}))

let scratch: string
const savedInputs = {
  version: 1,
  toolchainVersion: '22.1.8',
  profileDirectory: '/fixture/profiles',
  objects: [{ path: '/fixture/sockeye', sha256: '0'.repeat(64) }],
  sources: [{ path: '/fixture/source.cc', sha256: '1'.repeat(64) }],
}
const tools = {
  version: '22.1.8',
  clang: '/fixture/clang',
  clangxx: '/fixture/clang++',
  llvmCov: '/fixture/llvm-cov',
  llvmProfdata: '/fixture/llvm-profdata',
}

beforeEach(() => {
  vi.resetAllMocks()
  scratch = mkdtempSync(path.join(os.tmpdir(), 'sockeye-phase-test-'))
  boundary.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  boundary.tools.mockResolvedValue(tools)
  boundary.create.mockReturnValue(savedInputs)
  boundary.parse.mockReturnValue(savedInputs)
  boundary.export.mockResolvedValue(
    new Map(NATIVE_COVERAGE_ROOTS.map(root => [root, `TN:${root}\n`])),
  )
})
afterEach(async () => {
  await safeDelete(scratch)
})

function phaseConfig() {
  return {
    phase: 'prepare',
    manifest: path.join(scratch, 'executor.json'),
    scratch,
    roots: [...NATIVE_COVERAGE_ROOTS],
  }
}
function preparedProfiles(): string {
  const state: { profiles: string } = JSON.parse(
    readFileSync(path.join(scratch, 'sockeye-native-state.json'), 'utf8'),
  )
  return state.profiles
}
function nativeReceipt() {
  return {
    success: true,
    numPassedTests: NATIVE_COVERAGE_TESTS.length,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numTotalTests: NATIVE_COVERAGE_TESTS.length,
    testResults: NATIVE_COVERAGE_TESTS.map(file => ({
      name: path.resolve(REPO_ROOT, file),
      status: 'passed',
      assertionResults: [{ status: 'passed' }],
    })),
  }
}
function reportFixture() {
  const profiles = path.join(scratch, 'sockeye-profiles-fixture')
  mkdirSync(profiles)
  writeFileSync(
    path.join(scratch, 'sockeye-native-state.json'),
    JSON.stringify({ profiles }),
  )
  writeFileSync(
    getNativeCoverageReceiptPath(profiles),
    JSON.stringify(nativeReceipt()),
  )
  writeFileSync(path.join(profiles, 'fixture.profraw'), 'fixture profile')
  writeFileSync(
    path.join(scratch, 'sockeye-native-inputs.json'),
    JSON.stringify(savedInputs),
  )
  return profiles
}

test('failed build cannot publish prepared inputs or an execution manifest', async () => {
  boundary.spawn.mockRejectedValueOnce(
    Object.assign(new Error('fixture build failure'), {
      code: 1,
      stdout: '',
      stderr: 'fixture compiler error',
    }),
  )
  await expect(prepareNativeCoverage(phaseConfig())).rejects.toThrow()
  expect(boundary.create).not.toHaveBeenCalled()
  expect(existsSync(path.join(scratch, 'sockeye-native-inputs.json'))).toBe(
    false,
  )
  expect(existsSync(phaseConfig().manifest)).toBe(false)
})

test('preparation snapshots inputs after building and emits every required report', async () => {
  boundary.spawn.mockImplementationOnce(async () => {
    expect(boundary.create).not.toHaveBeenCalled()
    expect(existsSync(preparedProfiles())).toBe(true)
    return { code: 0, stdout: '', stderr: '' }
  })
  await prepareNativeCoverage(phaseConfig())
  const profiles = preparedProfiles()
  expect(boundary.tools).toHaveBeenCalledWith(REPO_ROOT)
  expect(boundary.spawn).toHaveBeenCalledWith(
    process.execPath,
    ['scripts/repo/build.mts'],
    expect.objectContaining({
      cwd: REPO_ROOT,
      env: expect.objectContaining({
        BUILD_MODE: 'coverage',
        SOCKEYE_COVERAGE_PROFILE_FILE: getNativeProfilePattern(profiles),
      }),
    }),
  )
  expect(boundary.create).toHaveBeenCalledWith(
    expect.objectContaining({
      toolchainVersion: tools.version,
      profileDirectory: profiles,
      objects: expect.arrayContaining([
        expect.stringContaining('sockeye-keychain-framework-test'),
      ]),
      sources: expect.arrayContaining([
        path.resolve(REPO_ROOT, NATIVE_COVERAGE_ROOTS[2]!),
      ]),
    }),
  )
  expect(
    JSON.parse(
      readFileSync(path.join(scratch, 'sockeye-native-inputs.json'), 'utf8'),
    ),
  ).toEqual(savedInputs)
  expect(JSON.parse(readFileSync(phaseConfig().manifest, 'utf8'))).toEqual({
    version: 1,
    executors: [
      {
        command: process.execPath,
        args: [
          'scripts/repo/cover-cpp.mts',
          '--phase',
          'execute',
          '--manifest',
          phaseConfig().manifest,
          '--scratch-dir',
          scratch,
          ...NATIVE_COVERAGE_ROOTS.flatMap(root => ['--path', root]),
        ],
        cwd: REPO_ROOT,
        lane: 'slow',
      },
    ],
    reports: NATIVE_COVERAGE_ROOTS.map((root, index) => ({
      root,
      path: path.join(scratch, `sockeye-native-${index}.lcov`),
    })),
  })
  await prepareNativeCoverage(phaseConfig())
  expect(preparedProfiles()).not.toBe(profiles)
  expect(existsSync(profiles)).toBe(true)
})

test('execute runs only selected native suites and validates their receipt', async () => {
  const profiles = reportFixture()
  await executeNativeCoverage(phaseConfig())
  expect(boundary.spawn).toHaveBeenCalledWith(
    process.execPath,
    expect.arrayContaining([
      ...NATIVE_COVERAGE_TESTS,
      `--outputFile=${getNativeCoverageReceiptPath(profiles)}`,
    ]),
    expect.objectContaining({
      env: expect.objectContaining({
        BUILD_MODE: 'coverage',
        SOCKEYE_INTERACTIVE_TESTS: '',
        LLVM_PROFILE_FILE: getNativeProfilePattern(profiles),
      }),
    }),
  )
  expect(boundary.stdout).toHaveBeenCalledWith(
    `Native Vitest: 0 tests failed out of ${NATIVE_COVERAGE_TESTS.length}\n`,
  )
})

test.each(['execute', 'report'])(
  '%s rejects incomplete native suite evidence',
  async phase => {
    const profiles = reportFixture()
    const receipt = nativeReceipt()
    receipt.testResults.pop()
    writeFileSync(
      getNativeCoverageReceiptPath(profiles),
      JSON.stringify(receipt),
    )
    await expect(
      (phase === 'execute' ? executeNativeCoverage : reportNativeCoverage)(
        phaseConfig(),
      ),
    ).rejects.toThrow()
    expect(boundary.stdout).not.toHaveBeenCalled()
    expect(boundary.export).not.toHaveBeenCalled()
  },
)

test('report rejects absent saved input evidence before exporting', async () => {
  const profiles = path.join(scratch, 'sockeye-profiles-fixture')
  mkdirSync(profiles)
  writeFileSync(
    path.join(scratch, 'sockeye-native-state.json'),
    JSON.stringify({ profiles }),
  )
  writeFileSync(
    getNativeCoverageReceiptPath(profiles),
    JSON.stringify(nativeReceipt()),
  )
  writeFileSync(path.join(profiles, 'fixture.profraw'), 'fixture profile')
  await expect(reportNativeCoverage(phaseConfig())).rejects.toThrow()
  expect(boundary.export).not.toHaveBeenCalled()
})

test.each(['malformed', 'stale'])(
  'report rejects %s input evidence without publishing coverage',
  async failure => {
    reportFixture()
    if (failure === 'malformed')
      boundary.parse.mockImplementationOnce(() => {
        throw new Error('fixture invalid manifest')
      })
    else
      boundary.export.mockRejectedValueOnce(
        new Error('fixture input hash mismatch'),
      )
    await expect(reportNativeCoverage(phaseConfig())).rejects.toThrow()
    expect(existsSync(path.join(scratch, 'sockeye-native-0.lcov'))).toBe(false)
    if (failure === 'malformed') expect(boundary.export).not.toHaveBeenCalled()
  },
)

test('report forwards saved provenance and only raw profiles to the shared exporter', async () => {
  const profiles = reportFixture()
  writeFileSync(path.join(profiles, 'unrelated.txt'), 'ignored')
  await reportNativeCoverage(phaseConfig())
  expect(boundary.parse).toHaveBeenCalledWith(JSON.stringify(savedInputs))
  expect(boundary.export).toHaveBeenCalledWith(
    expect.objectContaining({
      tools,
      manifest: savedInputs,
      repoRoot: REPO_ROOT,
      profiles: [path.join(profiles, 'fixture.profraw')],
      mergedProfile: path.join(scratch, 'sockeye-native.profdata'),
      roots: NATIVE_COVERAGE_ROOTS.map(root =>
        expect.objectContaining({ root, requiredSources: expect.any(Array) }),
      ),
    }),
  )
  for (const [index, root] of NATIVE_COVERAGE_ROOTS.entries())
    expect(
      readFileSync(path.join(scratch, `sockeye-native-${index}.lcov`), 'utf8'),
    ).toBe(`TN:${root}\n`)
})

test.each(NATIVE_COVERAGE_ROOTS)(
  'report requires exporter output for root %s',
  async missing => {
    reportFixture()
    boundary.export.mockResolvedValueOnce(
      new Map(
        NATIVE_COVERAGE_ROOTS.filter(root => root !== missing).map(root => [
          root,
          `TN:${root}\n`,
        ]),
      ),
    )
    await expect(reportNativeCoverage(phaseConfig())).rejects.toThrow()
    for (const index of NATIVE_COVERAGE_ROOTS.keys())
      expect(
        existsSync(path.join(scratch, `sockeye-native-${index}.lcov`)),
      ).toBe(false)
  },
)
