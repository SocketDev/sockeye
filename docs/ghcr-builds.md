# Sockeye main builds

Each push to `main` builds, signs, and notarizes both macOS architectures.
The workflow publishes their ZIP archives to `ghcr.io/socketdev/sockeye`.
The `main` tag follows the latest build. The `sha-<commit>` tag identifies
one source commit.

Pull the latest build and extract the ARM64 archive:

```sh
image=ghcr.io/socketdev/sockeye:main
docker pull "$image"
container=$(docker create "$image")
docker cp "$container:/sockeye-darwin-arm64.zip" .
docker cp "$container:/sockeye-darwin-arm64.zip.sha256" .
docker rm "$container"
shasum -a 256 -c sockeye-darwin-arm64.zip.sha256
```

Use `/sockeye-darwin-x64.zip` to extract the Intel archive. Replace `main`
with `sha-<commit>` to pull a specific build.

GHCR package visibility controls anonymous downloads. Versioned releases use
the user-selected `v*` tag and the existing GitHub Release workflow.
