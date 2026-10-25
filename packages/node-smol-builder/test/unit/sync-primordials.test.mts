import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'
import { addPrimordialsProtection } from '../../scripts/vendor-fast-webstreams/sync-primordials.mts'

const captured = {
  PromisePrototypeThen(
    promise: Promise<unknown>,
    onFulfilled: () => void,
    onRejected: (reason: unknown) => void,
  ) {
    return Promise.prototype.then.call(promise, onFulfilled, onRejected)
  },
  PromiseReject: Promise.reject.bind(Promise),
  PromiseResolve: Promise.resolve.bind(Promise),
  SafePromise: Promise,
}

function evaluateProtected(source: string, filename: string, context = {}) {
  const result: unknown = runInNewContext(
    addPrimordialsProtection(source, filename),
    { primordials: captured, ...context },
  )
  return result
}

test('leaves files without Promise operations unchanged', () => {
  const source = "'use strict'\nmodule.exports = 42"
  expect(addPrimordialsProtection(source, 'reader.js')).toBe(source)
})

test.each([
  "'use strict'\n",
  "'use strict';\n",
  "'use strict'; ",
  '"use strict";\n',
  '',
])('resolve protection executes with directive %j', async directive => {
  await expect(
    evaluateProtected(`${directive}Promise.resolve(42)`, 'reader.js', {
      Promise: {
        resolve() {
          throw new Error('polluted Promise.resolve')
        },
      },
    }),
  ).resolves.toBe(42)
})

test('reject and construction protection preserve settlement values', async () => {
  await expect(
    evaluateProtected(
      "'use strict'\nPromise.reject('example-rejection')",
      'writer.js',
    ),
  ).rejects.toBe('example-rejection')
  await expect(
    evaluateProtected(
      "'use strict'\nnew Promise(resolve => resolve(17))",
      'writer.js',
    ),
  ).resolves.toBe(17)
})

test('non-pipe Promise.all retains its result array without invalid imports', async () => {
  await expect(
    evaluateProtected("'use strict'\nPromise.all([1, 2])", 'consumer.js', {
      Promise,
    }),
  ).resolves.toEqual([1, 2])
})

test('pipe settlement waits for every fulfillment and discards values', async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => {
    release = resolve
  })
  let settled = false
  const result = evaluateProtected(
    "'use strict'\nPromise.all(promises)",
    'pipe-to.js',
    { promises: [Promise.resolve(1), pending] },
  )
  void Promise.resolve(result).then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  release!()
  await expect(result).resolves.toBeUndefined()
  await expect(
    evaluateProtected("'use strict'\nPromise.all([])", 'pipe-to.js'),
  ).resolves.toBeUndefined()
})

test('pipe settlement preserves the first delivered rejection', async () => {
  const first = Promise.reject(new Error('example-first-rejection'))
  const second = Promise.reject(new Error('example-second-rejection'))
  await expect(
    evaluateProtected("'use strict'\nPromise.all(promises)", 'pipe-to.js', {
      promises: [first, second],
    }),
  ).rejects.toBe(await first.catch(error => error))
})

test('combined transforms import SafePromise once and execute the pipeline', async () => {
  const source =
    "'use strict'\nPromise.all([new Promise(resolve => resolve()), Promise.resolve()])"
  await expect(evaluateProtected(source, 'pipe-to.js')).resolves.toBeUndefined()
})
