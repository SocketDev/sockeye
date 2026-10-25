import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'
import { expect, test } from 'vitest'

import { MARKDOWN_EXAMPLE_URL, MARKDOWN_RUNTIME_PATH } from '../paths.mts'

test('renders heading, list and multiline code events through the native API adapter', async () => {
  const source = `
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    globalThis.setInterval = () => 0
    globalThis.markdownDraws = []
    const { processEvents } = await import(${JSON.stringify(MARKDOWN_EXAMPLE_URL)})
    const { blockType, eventCategory, spanType, textType } = await import('node:smol-markdown')
    const cases = [
      [[eventCategory.BLOCK_ENTER | blockType.H, 1], [eventCategory.TEXT, 'Heading'], [eventCategory.BLOCK_LEAVE | blockType.H]],
      [[eventCategory.BLOCK_ENTER | blockType.LI], [eventCategory.TEXT, 'item'], [eventCategory.BLOCK_LEAVE | blockType.LI]],
      [[eventCategory.BLOCK_ENTER | blockType.CODE], [eventCategory.TEXT | textType.CODE, 'first\\nsecond'], [eventCategory.BLOCK_LEAVE | blockType.CODE]],
      [[eventCategory.SPAN_ENTER | spanType.STRONG], [eventCategory.SPAN_ENTER | spanType.EM], [eventCategory.TEXT, 'combined'], [eventCategory.SPAN_LEAVE | spanType.EM], [eventCategory.SPAN_LEAVE | spanType.STRONG], [eventCategory.BLOCK_LEAVE | blockType.P]],
      [[eventCategory.SPAN_ENTER | spanType.CODE], [eventCategory.TEXT, 'inline'], [eventCategory.SPAN_LEAVE | spanType.CODE], [eventCategory.BLOCK_LEAVE | blockType.P]],
      [[eventCategory.TEXT, 42]],
    ]
    const results = cases.map(events => {
      globalThis.markdownDraws = []
      const state = { y: 1, attrs: 0, fgR: 220, fgG: 220, fgB: 220, inHeading: false, headingLevel: 0, rendererId: 1, width: 80 }
      processEvents(events, state)
      return { draws: globalThis.markdownDraws, y: state.y, inHeading: state.inHeading }
    })
    write(JSON.stringify(results))
  `
  const result = await spawn(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      '--import',
      MARKDOWN_RUNTIME_PATH,
      '--input-type=module',
      '--eval',
      source,
    ],
    { stdio: 'pipe', timeout: 5000 },
  )
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual([
    {
      draws: [{ text: 'Heading', y: 1, color: [255, 200, 100], attrs: 1 }],
      y: 3,
      inHeading: false,
    },
    {
      draws: [{ text: '  • item', y: 1, color: [220, 220, 220], attrs: 0 }],
      y: 2,
      inHeading: false,
    },
    {
      draws: [
        { text: 'first', y: 1, color: [150, 255, 150], attrs: 0 },
        { text: 'second', y: 2, color: [150, 255, 150], attrs: 0 },
      ],
      y: 4,
      inHeading: false,
    },
    {
      draws: [{ text: 'combined', y: 1, color: [220, 220, 220], attrs: 0 }],
      y: 3,
      inHeading: false,
    },
    {
      draws: [{ text: 'inline', y: 1, color: [220, 220, 220], attrs: 0 }],
      y: 3,
      inHeading: false,
    },
    { draws: [], y: 1, inHeading: false },
  ])
})
