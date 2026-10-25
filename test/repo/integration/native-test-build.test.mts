import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { expect, test } from 'vitest'

import { getBuildMode, getCmakeBuildDir } from '../../../scripts/repo/paths.mts'

interface CompileCommand {
  command: string
  file: string
}

test('native security targets retain assertions and sanitizer instrumentation', () => {
  const mode = getBuildMode()
  const build = getCmakeBuildDir(mode, `${process.platform}-${process.arch}`)
  const commands = JSON.parse(
    readFileSync(path.join(build, 'compile_commands.json'), 'utf8'),
  ) as CompileCommand[]
  const sanitizer =
    mode === 'asan' ? 'address' : mode === 'ubsan' ? 'undefined' : undefined
  for (const target of [
    'sockeye-input-policy-test',
    'sockeye-child-process-test',
    'sockeye-portable-core-test',
    'sockeye-file-identity-failures-test',
    'sockeye-child-process-failures-test',
    'sockeye-main-effects-test',
    'sockeye-addon-test',
    'sockeye-terminal-test',
    'sockeye-stdin-secret-test',
    'sockeye-one-password-test',
    'sockeye-keychain-framework-test',
    'sockeye-keystore-framework-test',
    'sockeye-run-request-test',
    'sockeye-request-record-test',
    'sockeye-preview-isolation-test',
    'sockeye-readiness-test',
    'sockeye-doctor-test',
    'sockeye-keychain-observer',
    'sockeye-keychain-policy-fixture',
  ]) {
    const compile = commands.filter(entry =>
      entry.command.includes(`CMakeFiles/${target}.dir/`),
    )
    expect(compile.length).toBeGreaterThan(0)
    for (const entry of compile) {
      expect(entry.command).toContain('-UNDEBUG')
      expect(entry.command.lastIndexOf('-UNDEBUG')).toBeGreaterThan(
        entry.command.lastIndexOf('-DNDEBUG'),
      )
      if (mode === 'coverage') {
        expect(entry.command).toContain('-fprofile-instr-generate=')
        expect(entry.command).toContain('-fcoverage-mapping')
      }
      if (sanitizer) {
        expect(entry.command).toContain(`-fsanitize=${sanitizer}`)
      }
    }
    if (sanitizer) {
      const link = readFileSync(
        path.join(build, 'CMakeFiles', `${target}.dir`, 'link.txt'),
        'utf8',
      )
      expect(link).toContain(`-fsanitize=${sanitizer}`)
    }
  }
  const production = commands.filter(entry =>
    entry.command.includes('CMakeFiles/sockeye.dir/'),
  )
  expect(production.length).toBeGreaterThan(0)
  for (const entry of production) {
    expect(entry.command).not.toContain('SOCKEYE_TESTING')
    if (mode === 'coverage') {
      expect(entry.command).toContain('-fprofile-instr-generate=')
      expect(entry.command).toContain('-fcoverage-mapping')
    }
  }
})
