# Changelog

## 0.2.0 - 2026-08-17

### Added

- **`setup`** — add the sockeye installer and inline the codesign-certs action
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — add the repo logomark
- **`keychain`** — adopt the keychain and credential-broker stack from socket-btm

### Changed

- _rename the proteus daemon to sockeye_

### Fixed

- **`build-infra`** — cache external tools under the repo .cache, not node\_modules
- **`build-infra`** — clear the oxlint backlog without suppressions
- **`catalog`** — add the missing acorn, acorn-walk, and adm-zip entries
- **`marker`** — declare repo.type mono to match the workspace on disk
- **`catalog`** — sync the sdk -stable alias to the held base version

### Internal

- **`ci`** — add the macOS signing and notarization workflow
- **`deps`** — regenerate the taze patch against 19.17.2 and bump typebox
- **`deps`** — pin acorn and adm-zip to their soaked latest
- **`fleet`** — resync -stable aliases, drop scripts with missing targets
