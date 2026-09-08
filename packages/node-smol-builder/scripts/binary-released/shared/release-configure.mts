import { existsSync } from 'node:fs'
import process from 'node:process'
import { getBuildPaths as getDawnBuildPaths } from 'local-dawn-builder/scripts/paths'
import { getCurrentPlatformArch } from 'local-build-infra/lib/platform-mappings'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

export function appendReleaseConfigureFlags(
  configureFlags: string[],
  extraConfigureFlags: readonly string[],
): void {
  if (extraConfigureFlags.length) {
    const present = new Set(configureFlags)
    const added = []
    for (const flag of extraConfigureFlags) {
      if (!present.has(flag)) {
        configureFlags.push(flag)
        present.add(flag)
        added.push(flag)
      }
    }
    if (added.length) {
      logger.log(`Extra configure flags (bundle-driven): ${added.join(' ')}`)
    }
  }
}

export function configureReleaseArchitecture(
  configureFlags: string[],
  config: { allowCross: boolean; arch: string; platform: string },
): boolean {
  const { allowCross, arch, platform } = config
  const IS_WINDOWS = platform === 'win32'
  const hostArch = process.arch
  const isArchMismatch = arch !== hostArch
  const isCrossCompiling = isArchMismatch && (IS_WINDOWS || allowCross)
  if (isCrossCompiling) {
    if (IS_WINDOWS) {
      logger.log(`Cross-compiling for Windows ${arch} on ${hostArch} host`)
    } else {
      logger.warn(
        `Cross-compiling for ${platform} ${arch} on ${hostArch} host (experimental)`,
      )
      logger.warn(
        '   This may cause build errors. Use a native runner if possible.',
      )
    }
    configureFlags.push(`--dest-cpu=${arch}`)
  } else if (isArchMismatch) {
    logger.fail(
      `Cross-compilation not supported: building ${arch} on ${hostArch} host`,
    )
    logger.log(`   Use a native ${arch} runner or add --allow-cross flag.`)
    throw new Error('Cross-compilation not supported')
  }

  return isCrossCompiling
}

export async function getReleaseConfigureFlags(config) {
  const {
    allowCross,
    arch,
    buildMode,
    isProdBuild,
    libc,
    platform,
    withDawn,
    withLief,
    extraConfigureFlags = [],
  } = config
  const IS_LINUX = platform === 'linux'
  const IS_MACOS = platform === 'darwin'
  const IS_MUSL = libc === 'musl'
  const configureFlags = [
    '--ninja',
    '--with-intl=small-icu',
    '--without-npm',
    '--without-amaro',
    '--without-node-options',
    '--experimental-enable-pointer-compression',
    // Node 26 ships Temporal via temporal_rs (Rust crate) linked
    // statically. socket-btm replaces this with the temporal-infra
    // C++ port: patch 004 lands the port sources in libnode; patch
    // 021 hijacks the deps/crates/crates.gyp:temporal_capi target to
    // compile our C++ port instead of building the Rust crate (so
    // V8's mksnapshot — which links temporal_capi but NOT libnode —
    // still resolves the temporal symbols); patch 018 disables
    // configure.py's cargo gate (the cargo/rustc probe near line 1580).
    // No rustc/cargo on PATH needed.
    '--v8-enable-temporal-support',
  ]

  // LIEF/binject support: disabled by default, enable with --with-lief flag
  // When disabled, --build-sea flag is silently ignored (patch 014)
  if (!withLief) {
    // Only disable LIEF when explicitly NOT wanted
    // Otherwise defaults to enabled (Node.js default on mac/linux/win)
    configureFlags.push('--without-lief')
  }

  await verifyReleaseDawnArtifact({ withDawn, buildMode })

  // For Linux x64 builds, disable OpenSSL assembly to avoid AVX/AVX2 instructions
  // that may not be available on all x86-64 CPUs (e.g., GitHub Actions runners).
  // This ensures binary portability across different CPU generations.
  if (IS_LINUX && arch === 'x64') {
    configureFlags.push('--openssl-no-asm')
  }

  if (isProdBuild) {
    configureFlags.push('--without-inspector')
    // Enable LTO for smaller binaries and better optimization.
    // Linux: Uses GCC/Clang LTO.
    // macOS: Uses Apple Clang's -flto=thin for faster builds with good optimization.
    if (IS_LINUX || IS_MACOS) {
      configureFlags.push('--enable-lto')
    }
  }

  // For musl builds, statically link libstdc++ to avoid runtime dependencies
  if (IS_MUSL) {
    configureFlags.push('--fully-static')
  }

  const isCrossCompiling = configureReleaseArchitecture(configureFlags, {
    allowCross,
    arch,
    platform,
  })

  appendReleaseConfigureFlags(configureFlags, extraConfigureFlags)

  return { __proto__: null, configureFlags, isCrossCompiling }
}

export async function verifyReleaseDawnArtifact(config: {
  withDawn: boolean
  buildMode: string
}): Promise<void> {
  const { withDawn, buildMode } = config
  if (withDawn) {
    const dawnPaths = getDawnBuildPaths(
      buildMode,
      await getCurrentPlatformArch(),
    )
    if (!existsSync(dawnPaths.outputLibFile)) {
      throw new Error(
        '--with-dawn requested but dawn-builder artifact is missing.\n\n' +
          `Expected: ${dawnPaths.outputLibFile}\n\n` +
          'Build Dawn first:\n' +
          '  pnpm --filter dawn-builder build' +
          (buildMode === 'prod' ? ':prod' : '') +
          '\n\n' +
          'Then re-run this build with --with-dawn.',
      )
    }
    // D6 will append: `configureFlags.push('--with-dawn')` here.
    // For now the gate alone is the integration contract — the
    // HAVE_DAWN compile-time define wiring (configure.py + node.gyp)
    // lands once the Dawn build has been smoke-tested.
  }
}
