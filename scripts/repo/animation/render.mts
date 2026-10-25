import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain, type ScriptMeta } from '../../fleet/process/main/run.mts'
import { scriptStdio } from '../../fleet/process/script-output.mts'
import {
  FINGERPRINT_RENDER_ROOT,
  FINGERPRINT_ATLAS,
  FINGERPRINT_BUILD_ROOT,
  FINGERPRINT_FRAMES_ROOT,
  FINGERPRINT_MANIFEST,
  FINGERPRINT_PREVIEW_ROOT,
  FINGERPRINT_RENDERER,
  FINGERPRINT_SOURCE,
} from '../paths/animation.mts'

export const SCRIPT_META: ScriptMeta = {
  describe:
    'Render the fingerprint animation with FFrames and update the embedded atlas.',
  help: 'Usage: pnpm animation:render',
  heavyJob: 'build',
  json: 'result',
}

export async function renderFingerprintAnimation(): Promise<void> {
  const source: { frames: string[] } = JSON.parse(
    await readFile(FINGERPRINT_SOURCE, 'utf8'),
  )
  async function run(command: string, args: string[]): Promise<void> {
    const result = await spawn(command, args, {
      cwd: FINGERPRINT_RENDER_ROOT,
      stdio: scriptStdio('inherit'),
    })
    if (result.code !== 0)
      throw new Error(
        `Fingerprint render failed: ${command} exited ${result.code}.`,
      )
  }
  await mkdir(FINGERPRINT_FRAMES_ROOT, { recursive: true })
  await run('cargo', [
    'build',
    '--release',
    '--locked',
    '--manifest-path',
    FINGERPRINT_MANIFEST,
    '--target-dir',
    FINGERPRINT_BUILD_ROOT,
  ])
  await run(FINGERPRINT_RENDERER, ['inspect'])
  const indices = [...source.frames.keys()].map(String)
  await run(FINGERPRINT_RENDERER, [
    'frame',
    indices.join(','),
    '-o',
    FINGERPRINT_FRAMES_ROOT,
    '--renderer',
    'gpu',
  ])
  await run('magick', [
    'montage',
    ...indices.map(index => path.join(FINGERPRINT_FRAMES_ROOT, `${index}.png`)),
    '-tile',
    '8x8',
    '-geometry',
    '256x256+0+0',
    '-background',
    'none',
    FINGERPRINT_ATLAS,
  ])
  const alpha = await spawn(
    'magick',
    [
      FINGERPRINT_ATLAS,
      '-crop',
      '256x256',
      '+repage',
      '-format',
      '%[fx:p{0,0}.a]\n',
      'info:',
    ],
    { stdio: 'pipe' },
  )
  const corners = String(alpha.stdout ?? '')
    .trim()
    .split(/\s+/u)
  if (
    alpha.code !== 0 ||
    corners.length !== 64 ||
    corners.some(value => Number(value) !== 0)
  ) {
    throw new Error(
      'Fingerprint atlas has an opaque background. Set FFrames BACKGROUND_COLOR to Color::TRANSPARENT and render again.',
    )
  }
  await run(FINGERPRINT_RENDERER, [
    'strip',
    'all',
    '-n',
    '12',
    '--columns',
    '4',
    '-o',
    path.join(FINGERPRINT_PREVIEW_ROOT, 'strip.png'),
  ])
}

if (isMainModule(import.meta.url)) {
  runMain(renderFingerprintAnimation, SCRIPT_META)
}
