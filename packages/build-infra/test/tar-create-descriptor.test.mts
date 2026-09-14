import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

let fixtureDir: string
let fixturePath: string

beforeAll(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tar-descriptor-'))
  fixturePath = path.join(fixtureDir, 'tar-descriptor')
  const sourcePath = path.join(fixtureDir, 'tar-descriptor.c')
  await fs.writeFile(
    sourcePath,
    String.raw`
#include <stdio.h>
#include <string.h>
#include "socketsecurity/build-infra/tar_create.c"

int gzip_compress(const uint8_t *input, size_t input_size,
                  uint8_t **output, size_t *output_size, int level) {
    (void)input;
    (void)input_size;
    (void)output;
    (void)output_size;
    (void)level;
    return GZIP_ERROR;
}

size_t gzip_compress_bound(size_t input_size) {
    return input_size;
}

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    char pipe_path[MAX_PATH_LEN];
    if (snprintf(pipe_path, sizeof(pipe_path), "%s/example-pipe", argv[1]) < 0) return 3;
    if (mkfifo(pipe_path, 0600) != 0) return 4;
    tar_buffer_t buffer;
    if (tar_buffer_init(&buffer, TAR_BLOCK_SIZE) != TAR_OK) return 5;
    int result = tar_add_file(&buffer, argv[1], "example-pipe");
    tar_buffer_free(&buffer);
    return result == TAR_ERROR_READ_FAILED ? 0 : 6;
}
`,
  )
  const compiled = spawnSync(
    process.env.CC || 'cc',
    [
      '-std=c11',
      '-D_DARWIN_C_SOURCE',
      '-Ipackages/build-infra/src',
      sourcePath,
      '-o',
      fixturePath,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  )
  if (compiled.status !== 0) {
    throw new Error(String(compiled.stderr))
  }
})

afterAll(async () => {
  if (fixtureDir) {
    await safeDelete(fixtureDir)
  }
})

describe.skipIf(process.platform === 'win32')(
  'TAR descriptor validation',
  () => {
    it('rejects a FIFO without blocking on pathname open', async () => {
      const runDir = path.join(fixtureDir, 'run')
      await fs.mkdir(runDir)
      const result = spawnSync(fixturePath, [runDir], {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 2e3,
      })
      expect(result.status, String(result.stderr)).toBe(0)
    })
  },
)
