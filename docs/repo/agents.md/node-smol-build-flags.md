# Node-smol build flags

Run the builder from the repository root:

```sh
pnpm --filter local-node-smol-builder run build --prod
```

## Build options

- `--dev` selects development mode; `--prod` selects production mode.
- `--clean` clears build artifacts before the build.
- `--verify` enables verification.
- `--test` runs smoke tests; `--test-full` selects the extended tests.
- `--from-checkpoint`, `--stop-at`, and `--build-only` control the build phases.

## Binary size optimization

The release configuration uses `--with-intl=small-icu` and `--without-*`
flags, including `--without-npm` and `--without-amaro`. Feature selections
control additional flags. Measure output size in MB for each target and mode.

The compression strategy uses Zstandard through `binpress`. The compressed
binary contains a decompression stub. The build verifies the compressed
binary with a smoke test when the target can run on the host.

## Performance impact

Startup overhead depends on decompression and the target platform.
Runtime performance depends on the selected Node.js features and build mode.
Measure both with the shipped binary before changing configuration defaults.
