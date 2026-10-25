import { registerHooks } from 'node:module'

const sources = new Map([
  [
    'node:smol-tui',
    `
    export const ATTRIBUTE_BASE_MASK = 65535
    export const TextAttributes = { BOLD: 1, ITALIC: 2 }
    export function createRenderer() { return 1 }
    export function destroyRenderer() {}
    export function rendererClear() {}
    export function rendererDrawBox() {}
    export function rendererDrawTextWrapped(...args) {
      globalThis.markdownDraws.push({
        text: new TextDecoder().decode(args[5]),
        y: args[2],
        color: args.slice(6, 9),
        attrs: args[12],
      })
    }
    export function rendererFlush() { return 0 }
    export function rendererSize() { return { width: 80, height: 40 } }
    export function stringWidth(text) { return text.length }
  `,
  ],
  [
    'node:smol-markdown',
    `
    export const blockType = { H: 1, CODE: 2, LI: 3, P: 4 }
    export const spanType = { STRONG: 1, EM: 2, CODE: 3 }
    export const textType = { NORMAL: 0, CODE: 1 }
    export const eventCategory = { BLOCK_ENTER: 4096, BLOCK_LEAVE: 8192, SPAN_ENTER: 12288, SPAN_LEAVE: 16384, TEXT: 20480 }
    export function parseMarkdown() { return [] }
  `,
  ],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (sources.has(specifier)) {
      return { shortCircuit: true, url: specifier }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (sources.has(url)) {
      return { format: 'module', shortCircuit: true, source: sources.get(url) }
    }
    return nextLoad(url, context)
  },
})
