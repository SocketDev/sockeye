import { expect, test } from 'vitest'
import { parseNativeCoverageArgs } from '../../../scripts/repo/cover-cpp.mts'
import { NATIVE_COVERAGE_ROOTS } from '../../../scripts/repo/native-coverage.mts'
const roots = NATIVE_COVERAGE_ROOTS.flatMap(root => ['--path', root])
test.each(['prepare', 'execute', 'report'])(
  'accepts native phase %s with complete roots',
  phase => {
    expect(
      parseNativeCoverageArgs([
        '--phase',
        phase,
        '--manifest',
        '/example/plan.json',
        '--scratch-dir',
        '/example/scratch',
        ...roots,
      ]),
    ).toEqual({
      phase,
      manifest: '/example/plan.json',
      scratch: '/example/scratch',
      roots: NATIVE_COVERAGE_ROOTS,
    })
  },
)
test.for([
  [],
  ['--phase', 'unknown'],
  [
    '--phase',
    'prepare',
    '--manifest',
    'relative.json',
    '--scratch-dir',
    '/example/scratch',
  ],
  [
    '--phase',
    'prepare',
    '--manifest',
    '/example/plan.json',
    '--scratch-dir',
    'relative',
  ],
  ['--unexpected'],
])('rejects incomplete or unsafe invocation %j', args => {
  expect(() => parseNativeCoverageArgs([...args, ...roots])).toThrow()
})
