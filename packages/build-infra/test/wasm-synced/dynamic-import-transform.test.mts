import { expect, test, vi } from 'vitest'

import { applyCommonTransforms } from '../../wasm-synced/transform.mts'

test.each([
  ['import("example-module");', 'require("example-module");'],
  ['await import("example-module");', 'require("example-module");'],
  [
    'import("example-module")("outer-argument");',
    'require("example-module")("outer-argument");',
  ],
  ['const {createRequire} = await import("module");', ''],
  ['const {createRequire: loadModule} = await import("node:module");', ''],
  [
    'const {createRequire, otherMember} = await import("module");',
    'const {createRequire, otherMember} = require("module");',
  ],
  [
    'const {createRequire, ...remainingMembers} = await import("module");',
    'const {createRequire, ...remainingMembers} = require("module");',
  ],
  [
    'const {createRequire, otherMember} = require("module");',
    'const {createRequire, otherMember} = require("node:module");',
  ],
  [
    'const {createRequire, ...remainingMembers} = require("module");',
    'const {createRequire, ...remainingMembers} = require("node:module");',
  ],
  [
    'const {otherMember} = await import("module");',
    'const {otherMember} = require("module");',
  ],
  [
    'const {createRequire} = await import("example-module");',
    'const {createRequire} = require("example-module");',
  ],
  [
    'const {createRequire} = await import("example-module")("module");',
    'const {createRequire} = require("example-module")("module");',
  ],
])('transforms parsed dynamic import %s', async (source, expected) => {
  await expect(
    applyCommonTransforms({
      mjsContent: source,
      initFunctionName: 'createExampleModule',
      exportName: 'exampleModule',
      logger: { substep: vi.fn(), warn: vi.fn() },
    }),
  ).resolves.toBe(expected)
})

test('rejects import attributes that synchronous require cannot enforce', async () => {
  await expect(
    applyCommonTransforms({
      mjsContent: 'import("example.json", {with: {type: "json"}});',
      initFunctionName: 'createExampleModule',
      exportName: 'exampleModule',
      logger: { substep: vi.fn(), warn: vi.fn() },
    }),
  ).rejects.toThrow(Error)
})
