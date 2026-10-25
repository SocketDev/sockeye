export async function ensureBoringssl(platformArch: string): Promise<string> {
  throw new Error(`Unmocked fixture BoringSSL request: ${platformArch}`)
}

export function getCurrentBoringsslPlatformArch(): string {
  throw new Error('Unmocked fixture BoringSSL platform request')
}
