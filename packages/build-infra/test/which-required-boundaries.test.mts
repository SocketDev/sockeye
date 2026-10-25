import { expect, test } from 'vitest'
import { whichRequired } from '../lib/which-required.mts'

test('missing required executables fail before command execution', async () => {
  await expect(
    whichRequired('sockeye-fixture-executable-that-does-not-exist'),
  ).rejects.toThrow(Error)
})
