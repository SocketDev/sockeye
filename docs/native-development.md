# Native development and testing

Sockeye is a C++ command-line program with one Objective-C++ file for macOS
frameworks. Node.js scripts build and test it so the repository keeps the same
developer commands as the rest of the fleet.

## Source layout

| Path                               | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `src/sockeye/*.cc`                 | Portable C++ policy, process, terminal, and memory code.      |
| `src/sockeye/keychain-macos.mm`    | macOS Keychain and LocalAuthentication bridge.                |
| `CMakeLists.txt`                   | Native compiler, linker, warning, and local signing settings. |
| `scripts/repo/build.mts`           | Canonical CMake entry point and output-path owner.            |
| `scripts/repo/test.mts`            | Builds first, then starts the fleet Vitest runner.            |
| `test/repo/integration/*.test.mts` | Tests the compiled CLI as a child process.                    |

There is no `test/runtime`, `test/native`, or `test/cpp` top-level tier. The
test folder describes what kind of test it is, not which language produced the
program:

- `test/repo/unit` is for isolated behavior.
- `test/repo/integration` is for process and operating-system boundaries.
- `test/repo/e2e` is for complete release or installer flows.

If a future C++ test executable is useful, its source belongs below the matching
`test/repo/<kind>/native` area. A Vitest test still builds and starts it. This
keeps one test command, one result format, and one CI discovery path.

## Build

```sh
pnpm run build
```

Development output uses this shape:

```text
build/dev/darwin-arm64/out/Final/sockeye
```

`BUILD_MODE=prod pnpm run build` creates an optimized release-shaped build. It
does not make the binary publishable; signing and notarization are separate
release gates.

## Test

```sh
pnpm run test
```

The noninteractive suite stops before Touch ID and Keychain access. It checks
the command contract, rejects ambiguous manifests, and uses a canary value to
make sure errors do not echo secret input.

Manual security tests must use throwaway credentials. Never put a real
credential value in a fixture, snapshot, command argument, or test log.

## SVG assets

GitHub renders repository SVG files more reliably than large inline SVG blocks.
Keep repository-facing art under `assets/repo/`. The fleet preset owns
`assets/repo/badges/coverage.svg`; Sockeye owns
`assets/repo/brand/logomark.svg`. Reference these files from Markdown or HTML, and
run the pinned SVGO pass after editing Sockeye's mark:

```sh
pnpm run optimize:svg
```

`test/repo/unit/svg-assets.test.mts` checks that the committed asset is already
an SVGO fixpoint. A second optimization pass must produce the same markup.

## Native quality checks

The CMake build treats warnings as errors and enables stack protection. Run the
two sanitizer modes separately because they catch different bug classes:

```sh
pnpm run test:asan
pnpm run test:ubsan
```

ASan looks for invalid memory access and lifetime bugs. UBSan looks for C++
operations whose behavior is undefined. Each command rebuilds both the CLI and
the small native input-policy test with the selected sanitizer, then Vitest
starts the native test executables.

The fuzz target feeds arbitrary byte strings through the credential-name,
terminal-input, approval-display, and canonical manifest-field policies:

```sh
pnpm run fuzz
```

The local budget is 60 seconds. A release candidate should run at least 15
minutes with `SOCKEYE_FUZZ_SECONDS=900 pnpm run fuzz` and record the command,
compiler version, duration, and final execution count in the release evidence.
Fuzzing these pure byte-policy functions does not test Keychain UI behavior or
the final executable path race; those have separate release gates.
