import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { afterEach, expect, test, vi } from 'vitest'
import { printWarning } from '../lib/build-output.mts'

const logger = getDefaultLogger()

afterEach(() => vi.restoreAllMocks())
test('build warnings use the warning logger without altering the diagnostic', () => {
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  printWarning('Example compiler did not emit debug symbols')
  expect(warn).toHaveBeenCalledWith(
    'Example compiler did not emit debug symbols',
  )
})
