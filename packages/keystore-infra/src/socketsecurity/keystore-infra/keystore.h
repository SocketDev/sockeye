/*
 * keystore — the platform-agnostic credential store interface.
 *
 * sockeye.c (the daemon lifecycle) calls these; each platform provides the
 * implementation behind the same C ABI: macOS uses the Keychain with a
 * biometric ACL (keystore_macos.mm), Linux uses the Secret Service via libsecret
 * (keystore_linux.c), and Windows uses the Credential Manager (keystore_win.c).
 * Declared extern "C" so the Objective-C++ macOS backend links against the C
 * daemon without name mangling.
 */

#ifndef SOCKEYE_KEYSTORE_H
#define SOCKEYE_KEYSTORE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Operation result codes. */
#define KEYSTORE_OK 0
#define KEYSTORE_ERR_UNAVAILABLE (-1) /* no backend on this platform yet */
#define KEYSTORE_ERR_NOT_FOUND (-2)   /* no such service/account pair */
#define KEYSTORE_ERR_DENIED (-3)      /* biometric prompt failed or cancelled */
#define KEYSTORE_ERR_IO (-4)          /* underlying keystore API error */

/*
 * Read a secret into `out` (NUL-terminated on KEYSTORE_OK). Reading a
 * biometric-gated item triggers the OS biometric prompt. Returns a
 * KEYSTORE_ERR_* code on failure; `out` is untouched on failure.
 */
int keystore_get(const char* service, const char* account, char* out,
                 size_t out_len);

/*
 * Store a secret behind the platform's biometric ACL where one exists. An
 * existing value for the same service/account is replaced.
 */
int keystore_put(const char* service, const char* account, const char* value);

/*
 * Read a secret WITHOUT ever raising a biometric prompt. A silent slot (written
 * by keystore_put_silent) reads back directly; a biometric-gated item fails
 * closed with KEYSTORE_ERR_DENIED rather than showing a Touch ID sheet. For a
 * per-session hook that must not block on biometry (e.g. the AI balancer
 * reading its Fireworks key at every SessionStart). On platforms with no
 * biometric gate (Linux, Windows) this is identical to keystore_get.
 */
int keystore_get_silent(const char* service, const char* account, char* out,
                        size_t out_len);

/*
 * Store a secret readable WITHOUT a biometric prompt: on macOS the item carries
 * kSecAttrAccessibleWhenUnlockedThisDeviceOnly and NO access-control object, so
 * the socket-keychain binary family reads it while the keychain is unlocked. An
 * existing value for the same service/account is replaced. On platforms with no
 * biometric gate this is identical to keystore_put.
 */
int keystore_put_silent(const char* service, const char* account,
                        const char* value);

/*
 * Remove a secret. Returns KEYSTORE_OK even when the item was already absent.
 */
int keystore_delete(const char* service, const char* account);

#ifdef __cplusplus
}
#endif

#endif /* SOCKEYE_KEYSTORE_H */
