import { beforeEach, expect, test, vi } from 'vitest'
import { printBuildSummary } from '../../scripts/lib/build-summary.mts'

const log = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ log, step: vi.fn(), logNewline: vi.fn() }),
}))
beforeEach(() => vi.clearAllMocks())

test.each([false, true])(
  'reports artifact paths and next steps for compression=%s',
  compressed => {
    printBuildSummary({
      binarySize: '12 MB',
      compressed,
      cpuCount: 4,
      finalBinary: '/example/final/node',
      nodeBinary: '/example/source/node',
      outputCompressedBinary: '/example/compressed/node',
      outputReleaseBinary: '/example/release/node',
      outputStrippedBinary: '/example/stripped/node',
      totalTime: '3 minutes',
    })
    const transcript = log.mock.calls.flat().join('\n')
    for (const value of [
      '12 MB',
      '4',
      '3 minutes',
      '/example/final/node',
      '/example/source/node',
      '/example/release/node',
      '/example/stripped/node',
    ]) {
      expect(transcript).toContain(value)
    }
    expect(transcript.includes('/example/compressed/node')).toBe(compressed)
    expect(transcript.includes('/example/final/node --version')).toBe(
      compressed,
    )
    expect(transcript.includes('pnpm exec pkg .')).toBe(!compressed)
  },
)
