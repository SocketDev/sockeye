# Fingerprint scan

FFrames 1.3.0 renders the traced ridge shapes and fill progression from the supplied reference clip. The fill is red. The 57 frames preserve the active scan at 30 fps and omit the long idle holds.

Run `pnpm animation:render` to rebuild the PNG atlas embedded in Sockeye. The frame data in `scan.json` is the source; app builds embed the atlas and need no Rust or video decoder at runtime.
