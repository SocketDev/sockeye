import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

let fixtureDir: string
let fixturePath: string

beforeAll(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reserved-temp-file-'))
  fixturePath = path.join(fixtureDir, 'reserved-temp-file')
  const sourcePath = path.join(fixtureDir, 'reserved-temp-file.cpp')
  await fs.writeFile(
    sourcePath,
    String.raw`
#include <cstdio>
#include <cstring>
#include <string>
#include "socketsecurity/bin-infra/binject_file_utils.hpp"

extern "C" int create_parent_directories(const char*) { return 0; }
extern "C" int set_executable_permissions(const char*) { return 0; }

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    std::string root = argv[1];
    std::string output = root + "/output";
    binject::reserved_temp_file first;
    if (binject::create_temp_file(output.c_str(), &first) != 0) return 3;
    FILE* writer = fopen(first.write_path, "wb");
    if (!writer || fwrite("safe", 1, 4, writer) != 4 || fclose(writer) != 0) return 4;
    if (binject::verify_file_written(&first) != BINJECT_OK) return 5;
    if (binject::atomic_rename(&first, output.c_str()) != BINJECT_OK) return 6;
    FILE* reader = fopen(output.c_str(), "rb");
    char bytes[5] = {};
    if (!reader || fread(bytes, 1, 4, reader) != 4 || fclose(reader) != 0 ||
        strcmp(bytes, "safe") != 0) return 7;

    std::string victim = root + "/victim";
    writer = fopen(victim.c_str(), "wb");
    if (!writer || fwrite("keep", 1, 4, writer) != 4 || fclose(writer) != 0) return 8;
    binject::reserved_temp_file swapped;
    if (binject::create_temp_file((root + "/swapped").c_str(), &swapped) != 0) return 9;
#ifdef _WIN32
    std::string held = std::string(swapped.directory) + "/held";
    if (MoveFileExA(swapped.path, held.c_str(), MOVEFILE_REPLACE_EXISTING) ||
        DeleteFileA(swapped.path)) return 10;
    if (binject::write_temp_file(&swapped,
                                 reinterpret_cast<const uint8_t*>("held"), 4) != BINJECT_OK) return 11;
    if (binject::verify_file_written(&swapped) != BINJECT_OK) return 12;
    std::string bad_output = root + "/bad-output";
    if (binject::atomic_rename(&swapped, bad_output.c_str()) != BINJECT_OK) return 13;
    reader = fopen(bad_output.c_str(), "rb");
    memset(bytes, 0, sizeof(bytes));
    if (!reader || fread(bytes, 1, 4, reader) != 4 || fclose(reader) != 0 ||
        strcmp(bytes, "held") != 0) return 14;
#else
    if (binject::write_temp_file(&swapped,
                                 reinterpret_cast<const uint8_t*>("held"), 4) != BINJECT_OK) return 10;
    std::string held = std::string(swapped.directory) + "/held";
    if (rename(swapped.path, held.c_str()) != 0 ||
        symlink(victim.c_str(), swapped.path) != 0) return 11;
    if (binject::atomic_rename(&swapped, (root + "/bad-output").c_str()) == BINJECT_OK) return 12;
    reader = fopen(victim.c_str(), "rb");
    memset(bytes, 0, sizeof(bytes));
    if (!reader || fread(bytes, 1, 4, reader) != 4 || fclose(reader) != 0 ||
        strcmp(bytes, "keep") != 0) return 13;
    unlink(held.c_str());
    rmdir(swapped.directory);
#endif
    return 0;
}
`,
  )
  const compiler = process.env.CXX || 'c++'
  const compiled = spawnSync(
    compiler,
    [
      '-std=c++17',
      '-Ipackages/bin-infra/src',
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

describe('reserved temporary files', () => {
  it('keeps writes on the reserved identity and rejects a swapped path', async () => {
    const runDir = await fs.mkdtemp(path.join(fixtureDir, 'run-'))
    const result = spawnSync(fixturePath, [runDir], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    expect(result.status, String(result.stderr)).toBe(0)
    expect(existsSync(path.join(runDir, 'bad-output'))).toBe(
      process.platform === 'win32',
    )
  })
})
