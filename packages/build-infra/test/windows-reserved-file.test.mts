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
  if (process.platform !== 'win32') {
    return
  }
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-reservation-'))
  fixturePath = path.join(fixtureDir, 'cache-reservation.exe')
  const sourcePath = path.join(fixtureDir, 'cache-reservation.c')
  await fs.writeFile(
    sourcePath,
    String.raw`
#include <stdio.h>
#include <string.h>
#include <windows.h>

static int replacement_allowed;

static void attempt_path_replacement(const char *path) {
    char held[MAX_PATH];
    if (snprintf(held, sizeof(held), "%s.held", path) < 0) {
        replacement_allowed = 1;
        return;
    }
    if (MoveFileExA(path, held, MOVEFILE_REPLACE_EXISTING) || DeleteFileA(path)) {
        replacement_allowed = 1;
    }
}

#define SCACHE_TEST_BEFORE_RENAME(path) attempt_path_replacement(path)
#include "socketsecurity/build-infra/socket_cacache_fs.h"

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    char cache_dir[MAX_PATH];
    char output[MAX_PATH];
    if (snprintf(cache_dir, sizeof(cache_dir), "%s/cache", argv[1]) < 0 ||
        snprintf(output, sizeof(output), "%s/output", cache_dir) < 0) return 3;
    if (_putenv_s("SOCKET_CACACHE_DIR", cache_dir) != 0 ||
        _mkdir(cache_dir) != 0) return 4;
    if (write_file_atomically(output, (const uint8_t *)"safe", 4, 0600) != 0 ||
        replacement_allowed) return 5;
    FILE *file = fopen(output, "rb");
    char content[5] = {0};
    int valid = file && fread(content, 1, 4, file) == 4 &&
        strcmp(content, "safe") == 0;
    if (file) fclose(file);
    return valid ? 0 : 6;
}
`,
  )
  const compiled = spawnSync(
    process.env.CC || 'cc',
    [
      '-std=c11',
      '-Ipackages/build-infra/src',
      sourcePath,
      '-ladvapi32',
      '-o',
      fixturePath,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  )
  if (compiled.status !== 0) {
    throw new Error(compiled.stderr)
  }
})

afterAll(async () => {
  if (fixtureDir) {
    await safeDelete(fixtureDir)
  }
})

describe.skipIf(process.platform !== 'win32')(
  'Windows cache file reservation',
  () => {
    it('denies pathname replacement until the reserved write finishes', async () => {
      const runDir = await fs.mkdtemp(path.join(fixtureDir, 'run-'))
      const result = spawnSync(fixturePath, [runDir], {
        encoding: 'utf8',
        stdio: 'pipe',
      })
      expect(result.status, result.stderr).toBe(0)
    })
  },
)
