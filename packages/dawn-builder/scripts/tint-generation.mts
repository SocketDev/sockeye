import { existsSync, promises as fs } from 'node:fs'
import { which } from '@socketsecurity/lib-stable/exe/path/which'
import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { errorMessage } from 'local-build-infra/lib/error-utils'
import {
  getTintGenerationPaths,
  UPSTREAM_DAWN_DEPS,
  UPSTREAM_DAWN_DIR,
  UPSTREAM_DAWN_GIT,
  UPSTREAM_DAWN_MOVED_GIT,
} from './paths.mts'

const logger = getDefaultLogger()

export async function generateTintSources(cmakeDir: string): Promise<void> {
  // Generate Tint sources first, serially. Invoking via CMake's
  // tint_generate_sources target swallowed `go run` failures (cmake's
  // add_custom_command reports success even on non-zero exit when the
  // OUTPUT files exist from a prior run OR are declared but missing —
  // ninja just schedules dependents anyway). Calling `go run` directly
  // surfaces the real exit code and lets us fail loudly with the actual
  // gen tool's stderr.
  logger.step('Generating Tint source files (direct go run)')
  const goPath = await which('go')
  if (typeof goPath !== 'string') {
    throw new Error(
      `go not found on PATH. Dawn's Tint code generator requires Go; install actions/setup-go in the workflow.`,
    )
  }
  const { genOutDir, genBinDir, genBin, enumsCc } =
    getTintGenerationPaths(cmakeDir)
  // Compile the gen tool to a real binary under the dawn checkout
  // rather than using `go run`. Tint's fileutils.DawnRoot() walks up
  // from runtime.Caller's path looking for a DEPS file — `go run`
  // can normalize source paths in ways that defeat the walk (we've
  // seen 0.3s exits with no output even though the gen tool builds
  // cleanly). A `go build -o <dawn>/build/.../gen` keeps the source
  // paths embedded as the actual dawn checkout, so DawnRoot's walk
  // up from /<dawn>/tools/src/fileutils/paths.go finds DEPS at
  // /<dawn>/DEPS as expected.
  await safeMkdir(genBinDir, { recursive: true })
  logger.info(`Compiling gen → ${genBin}`)
  const buildBin = await spawn(
    goPath,
    ['build', '-o', genBin, './tools/src/cmd/gen'],
    { cwd: UPSTREAM_DAWN_DIR, stdio: 'inherit' },
  )
  if (buildBin.code !== 0) {
    throw new Error(
      `go build of Tint gen tool failed with exit code ${buildBin.code}.`,
    )
  }
  // Diagnostics — confirm what the gen binary will actually see.
  const depsPath = UPSTREAM_DAWN_DEPS
  logger.info(`UPSTREAM_DAWN_DIR=${UPSTREAM_DAWN_DIR}`)
  logger.info(`DEPS exists at ${depsPath}: ${existsSync(depsPath)}`)
  logger.info(`gen binary: ${genBin} (exists: ${existsSync(genBin)})`)
  logger.info(`output dir: ${genOutDir}`)
  // Strings dump of fileutils source paths embedded in the binary —
  // these are the values runtime.Caller will report, which DawnRoot's
  // walk-up uses to find DEPS. If the embedded path doesn't anchor at
  // <dawn>/tools/src/fileutils/, DawnRoot fails silently. Spawn each
  // tool directly + pipe in-process rather than via `sh -c`; the latter
  // EPIPE-poisons `strings`'s exit code when `head` closes early, and
  // shell-quoting a path with whitespace would break it.
  logger.info('Embedded fileutils paths in binary:')
  try {
    const stringsResult = await spawn('strings', [genBin], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const matches = (stringsResult.stdout ?? '')
      .split(/\r?\n/)
      .filter(
        l =>
          l.includes('fileutils/paths.go') || l.includes('tools/src/fileutils'),
      )
      .slice(0, 5)
    for (let i = 0, { length } = matches; i < length; i += 1) {
      const line = matches[i]!
      logger.info(`  ${line}`)
    }
  } catch (e) {
    logger.info(`strings probe skipped: ${errorMessage(e)}`)
  }
  // Upstream Tint's glob.Scan walker has a latent bug:
  //
  //   if rel == ".git" { return filepath.SkipDir }
  //
  // is meant to skip the .git DIRECTORY, but in a git submodule checkout
  // `.git` is a regular FILE (a gitdir pointer like
  // "gitdir: ../../.git/modules/<path>"). When filepath.Walk's callback
  // returns SkipDir for a file, Go skips the REMAINDER of the parent
  // directory — so the walker stops after 7 entries (`.bazelrc`,
  // `.bazelversion`, `.clang-format*`, `.git`) and never reaches
  // `src/tint/**/*.tmpl`, producing zero matches, zero generated files,
  // and a silent exit code 0.
  //
  // Workaround: temporarily move the .git file out of the way before
  // invoking gen, and restore it after. We can't patch upstream (fleet
  // forbids forks of canonical upstream sources), and the gen tool
  // doesn't honor any env-var override.
  const dotGit = UPSTREAM_DAWN_GIT
  const dotGitMoved = UPSTREAM_DAWN_MOVED_GIT
  const dotGitExists = existsSync(dotGit)
  if (dotGitExists) {
    await fs.rename(dotGit, dotGitMoved)
  }
  try {
    logger.info(
      `Running: ${genBin} sources ${genOutDir} (cwd=${UPSTREAM_DAWN_DIR})`,
    )
    const genResult = await spawn(genBin, ['sources', genOutDir], {
      cwd: UPSTREAM_DAWN_DIR,
      stdio: 'inherit',
    })
    logger.info(`gen exit code: ${genResult.code}`)
    if (genResult.code !== 0) {
      throw new Error(
        `Tint source generation failed with exit code ${genResult.code}.`,
      )
    }
  } finally {
    if (dotGitExists) {
      await fs.rename(dotGitMoved, dotGit)
    }
  }
  // Diagnostic: confirm the gen tool actually produced the canonical
  // first-target output file. If empty, fileutils.DawnRoot() returned
  // "" (couldn't walk up to DEPS) and glob matched 0 templates.
  if (!existsSync(enumsCc)) {
    throw new Error(
      `Tint gen produced no output: ${enumsCc} is missing. ` +
        `DawnRoot() likely returned "" (couldn't find DEPS in walked-up parents). ` +
        `Try running the gen binary with strace -f -e openat to confirm.`,
    )
  }
}
