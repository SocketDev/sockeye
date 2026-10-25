import { Parser } from 'acorn'
import { ancestor } from 'acorn-walk'
import MagicString from 'magic-string'
import { describe, expect, test } from 'vitest'

import { buildCallVisitor } from '../../wasm-synced/transform-call-visitor.mts'

function transformCalls(
  source: string,
  options: { moduleVar?: string | undefined } = {},
) {
  const output = new MagicString(source)
  const requireDeclaratorsToRemove = []
  const returnModuleToFix = []
  const topLevelStatementsToRemove = []
  ancestor(
    Parser.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }),
    buildCallVisitor({
      detectedModuleVar: options.moduleVar,
      mjsContent: source,
      requireDeclaratorsToRemove,
      returnModuleToFix,
      topLevelStatementsToRemove,
      safeOverwrite(start, end, content) {
        output.overwrite(start, end, content)
      },
      safeRemove(start, end) {
        output.remove(start, end)
      },
    }),
  )
  return {
    output: output.toString(),
    requireDeclaratorsToRemove,
    returnModuleToFix,
    topLevelStatementsToRemove,
  }
}

describe('synchronous call transformations', () => {
  test.each([
    ['findWasmBinary()', "''"],
    ['fa(moduleArg)', '(moduleRtn = moduleArg)'],
    ['fa(moduleArg, otherArg)', 'fa(moduleArg, otherArg)'],
    ['moduleArg.catch(handleError)', 'moduleArg'],
    ['require("fs")', 'require("node:fs")'],
    ['require("node:fs")', 'require("node:fs")'],
    ['require("example-package")', 'require("example-package")'],
    ['require(moduleName)', 'require(moduleName)'],
    ['require("url").fileURLToPath(__filename)', '__filename'],
    ['require("node:url").fileURLToPath(import.meta.url)', '__filename'],
    ['require("url").fileURLToPath(__importMetaUrl)', '__filename'],
    [
      'require("url").fileURLToPath(otherUrl)',
      'require("url").fileURLToPath(otherUrl)',
    ],
    ['fileURLToPath(__filename)', '__filename'],
    ['fileURLToPath(import.meta.url)', 'fileURLToPath(import.meta.url)'],
    ['fileURLToPath(__importMetaUrl)', 'fileURLToPath(__importMetaUrl)'],
    ['const {createRequire} = require("module");', ''],
    ['const {createRequire: loadModule} = require("node:module");', ''],
    [
      'let {createRequire} = require("module");',
      'let {createRequire} = require("node:module");',
    ],
    [
      'const {otherMember} = require("module");',
      'const {otherMember} = require("node:module");',
    ],
    [
      'const ENVIRONMENT_IS_NODE = process.versions && process.versions.node;',
      'const ENVIRONMENT_IS_NODE = true;',
    ],
    [
      'const ready = new Promise((resolve, reject) => {});',
      'const ready = null;',
    ],
    [
      'const ready = new Promise(resolve => {});',
      'const ready = new Promise(resolve => {});',
    ],
    ['moduleRtn = ia;\n', ''],
    [
      'function createModule() { return moduleRtn; }',
      'function createModule() { return D; }',
    ],
    [
      'function Module() { return moduleRtn; }',
      'function Module() { return Module; }',
    ],
  ])('rewrites %s', (source, expected) => {
    expect(transformCalls(source).output).toBe(expected)
  })

  test.each(['__filename', '__importMetaUrl', 'import.meta.url'])(
    'preserves directory detection for %s',
    base => {
      for (const callee of ['fileURLToPath', 'require("url").fileURLToPath']) {
        expect(transformCalls(`${callee}(new URL("./", ${base}))`).output).toBe(
          '__dirname',
        )
        expect(
          transformCalls(`${callee}(new URL("../", ${base}))`).output,
        ).toBe(`${callee}(new URL("../", ${base}))`)
      }
    },
  )

  test('keeps module selection and deferred removals', () => {
    expect(
      transformCalls('function createModule() { return moduleRtn; }', {
        moduleVar: 'moduleArg',
      }).output,
    ).toBe('function createModule() { return moduleArg; }')
    expect(
      transformCalls('function Module() { return Module; }').returnModuleToFix,
    ).toHaveLength(1)
    expect(
      transformCalls('function otherModule() { return Module; }')
        .returnModuleToFix,
    ).toHaveLength(0)
    expect(
      transformCalls('var require = loader, keep = true;')
        .requireDeclaratorsToRemove,
    ).toHaveLength(1)
  })
})
