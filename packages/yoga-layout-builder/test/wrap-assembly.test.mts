import { expect, test, vi } from 'vitest'
import { wrapAssembly } from '../src/wrapper/wrapAssembly.mts'
const Direction = { LTR: 1, RTL: 2 }
const Unit = { Percent: 2 }

const setters = [
  'setPosition',
  'setMargin',
  'setFlexBasis',
  'setWidth',
  'setHeight',
  'setMinWidth',
  'setMinHeight',
  'setMaxWidth',
  'setMaxHeight',
  'setPadding',
  'setGap',
]

function createBindings() {
  const calls = vi.fn()
  class LayoutNode {
    static create = vi.fn()
    static createDefault = vi.fn(() => new LayoutNode())
    static createWithConfig = vi.fn(() => new LayoutNode())
    static destroy = vi.fn()
    children: LayoutNode[] = []
    parent: LayoutNode | undefined
    setMeasureFunc(callback: unknown) {
      calls('measure', callback)
    }
    unsetMeasureFunc() {
      calls('unsetMeasure')
    }
    setDirtiedFunc(callback: unknown) {
      calls('dirtied', callback)
    }
    calculateLayout(...args: unknown[]) {
      calls('layout', ...args)
    }
    free() {}
    freeRecursive() {}
    getChildCount() {
      return this.children.length
    }
    getChild(index: number) {
      return this.children[index]
    }
  }
  LayoutNode.destroy.mockImplementation(node => {
    if (node.parent) {
      node.parent.children.splice(node.parent.children.indexOf(node), 1)
    }
    calls('destroy', node)
  })
  class LayoutConfig {
    static destroy = vi.fn()
    free() {}
  }
  for (let i = 0, { length } = setters; i < length; i += 1) {
    const name = setters[i]!
    for (const suffix of ['', 'Percent', 'Auto']) {
      Object.defineProperty(LayoutNode.prototype, `${name}${suffix}`, {
        configurable: true,
        writable: true,
        value: function (...args: unknown[]) {
          calls(`${name}${suffix}`, ...args)
        },
      })
    }
  }
  const lib = {
    Node: LayoutNode,
    Config: LayoutConfig,
    MeasureCallback: { implement: vi.fn(callback => callback) },
    DirtiedCallback: { implement: vi.fn(callback => callback) },
  }
  return { calls, lib }
}

test.each(setters)(
  '%s dispatches point, percentage, auto and unit objects',
  name => {
    const { calls, lib } = createBindings()
    const yoga = wrapAssembly(lib)
    const node = yoga.Node.create()
    const values: Array<[unknown, string, number | undefined]> = [
      [12, '', 12],
      ['25%', 'Percent', 25],
      ['30', '', 30],
      ['auto', 'Auto', undefined],
      [{ unit: Unit.Percent, valueOf: () => 75 }, 'Percent', 75],
    ]
    for (const [value, suffix, expected] of values) {
      node[name](2, value)
      expect(calls).toHaveBeenLastCalledWith(
        `${name}${suffix}`,
        2,
        ...(expected === undefined ? [] : [expected]),
      )
    }
  },
)

test('preserves unspecified dimensions and rejects invalid or unsupported values', () => {
  const { calls, lib } = createBindings()
  const yoga = wrapAssembly(lib)
  const node = yoga.Node.create()
  node.setWidth(undefined)
  expect(calls).toHaveBeenLastCalledWith('setWidth', NaN)
  node.setWidth(NaN)
  expect(calls).toHaveBeenLastCalledWith('setWidth', NaN)
  expect(() => node.setWidth('invalid')).toThrow()
  expect(() => node.setWidth({ unit: 999, valueOf: () => 1 })).toThrow()
})

test('rejects auto when the native binding does not provide that setter', () => {
  const { lib } = createBindings()
  Reflect.deleteProperty(lib.Node.prototype, 'setWidthAuto')
  const yoga = wrapAssembly(lib)
  expect(() => yoga.Node.create().setWidth('auto')).toThrow()
})

test('adapts measurement results and removes a null measurement callback', () => {
  const { calls, lib } = createBindings()
  const yoga = wrapAssembly(lib)
  const node = yoga.Node.create()
  const measure = vi.fn(() => ({ width: 10, height: undefined }))
  node.setMeasureFunc(measure)
  const callback = lib.MeasureCallback.implement.mock.calls[0]![0]
  expect(callback.measure(10, 20)).toEqual({ width: 10, height: NaN })
  expect(measure).toHaveBeenCalledWith(10, 20)
  node.setMeasureFunc(() => ({ height: 20 }))
  expect(lib.MeasureCallback.implement.mock.calls[1]![0].measure()).toEqual({
    width: NaN,
    height: 20,
  })
  node.setMeasureFunc(undefined)
  expect(calls).toHaveBeenLastCalledWith('unsetMeasure')
})

test('adapts dirty callbacks and preserves the changed node', () => {
  const { lib } = createBindings()
  const yoga = wrapAssembly(lib)
  const node = yoga.Node.create()
  const dirtied = vi.fn()
  node.setDirtiedFunc(dirtied)
  lib.DirtiedCallback.implement.mock.calls[0]![0].dirtied(node)
  expect(dirtied).toHaveBeenCalledWith(node)
})

test('dispatches constructors and releases recursively without skipping children', () => {
  const { calls, lib } = createBindings()
  const yoga = wrapAssembly(lib)
  const config = new yoga.Config()
  const parent = yoga.Node.create(config)
  expect(lib.Node.createWithConfig).toHaveBeenCalledWith(config)
  const first = yoga.Node.create()
  const second = yoga.Node.create()
  parent.children.push(first, second)
  first.parent = parent
  second.parent = parent
  parent.freeRecursive()
  expect(calls.mock.calls).toEqual([
    ['destroy', first],
    ['destroy', second],
    ['destroy', parent],
  ])
  config.free()
  expect(lib.Config.destroy).toHaveBeenCalledWith(config)
})

test('uses layout defaults and forwards explicit dimensions and direction', () => {
  const { calls, lib } = createBindings()
  const yoga = wrapAssembly(lib)
  const node = yoga.Node.create()
  node.calculateLayout()
  expect(calls).toHaveBeenLastCalledWith('layout', NaN, NaN, Direction.LTR)
  node.calculateLayout(100, 200, Direction.RTL)
  expect(calls).toHaveBeenLastCalledWith('layout', 100, 200, Direction.RTL)
  expect(yoga.Unit.Percent).toBe(2)
  expect(Object.getPrototypeOf(yoga)).toBeNull()
})
