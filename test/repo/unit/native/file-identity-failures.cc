#include "sockeye/file-identity.h"
#include <CommonCrypto/CommonDigest.h>
#include <cassert>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace {
struct State {
  int failure = 0;
  int reads = 0;
  int stats = 0;
  int opens = 0;
  int closes = 0;
  bool directory = false;
} state;
constexpr int kDescriptor = 51;
} // namespace
extern "C" char* SockeyeFileRealpath(const char* path, char* resolved) {
  if (state.failure == 1)
    return nullptr;
  std::strcpy(resolved, path);
  return resolved;
}
extern "C" int SockeyeFileOpen(const char*, int flags, ...) {
  assert((flags & (O_CLOEXEC | O_NOFOLLOW)) == (O_CLOEXEC | O_NOFOLLOW));
  if (state.failure == 2)
    return -1;
  ++state.opens;
  return kDescriptor;
}
extern "C" int SockeyeFileClose(int descriptor) {
  assert(descriptor == kDescriptor && state.opens == 1 && state.closes == 0);
  ++state.closes;
  return 0;
}
extern "C" int SockeyeFileStat(int descriptor, struct stat* metadata) {
  assert(descriptor == kDescriptor);
  ++state.stats;
  if (state.failure == 3 || (state.failure == 11 && state.stats == 2))
    return -1;
  *metadata = {};
  metadata->st_mode =
      static_cast<mode_t>((state.directory ? S_IFDIR : S_IFREG) | 0700);
  metadata->st_uid = geteuid();
  metadata->st_size = 3;
  metadata->st_dev = 7;
  metadata->st_ino = 9;
  metadata->st_mtimespec = {11, 13};
  if (state.failure == 4)
    metadata->st_uid = geteuid() + 1;
  if (state.failure == 5)
    metadata->st_size = -1;
  if (state.stats == 2) {
    switch (state.failure) {
    case 12:
      ++metadata->st_dev;
      break;
    case 13:
      ++metadata->st_ino;
      break;
    case 14:
      ++metadata->st_size;
      break;
    case 15:
      ++metadata->st_mtimespec.tv_sec;
      break;
    case 16:
      ++metadata->st_mtimespec.tv_nsec;
      break;
    }
  }
  return 0;
}
extern "C" ssize_t SockeyeFileRead(int descriptor, void* buffer,
                                   size_t capacity) {
  assert(descriptor == kDescriptor && capacity >= 3);
  ++state.reads;
  if (state.failure == 7) {
    errno = EIO;
    return -1;
  }
  if (state.failure == 8 && state.reads == 1) {
    errno = EINTR;
    return -1;
  }
  if (state.reads > (state.failure == 8 ? 2 : 1))
    return 0;
  std::memcpy(buffer, "abc", 3);
  return 3;
}
extern "C" int SockeyeFileDigestInit(CC_SHA256_CTX* context) {
  std::memset(context, 0, sizeof(*context));
  return state.failure == 6 ? 0 : 1;
}
extern "C" int SockeyeFileDigestUpdate(CC_SHA256_CTX*, const void* data,
                                       CC_LONG length) {
  assert(length == 3 && std::memcmp(data, "abc", 3) == 0);
  return state.failure == 9 ? 0 : 1;
}
extern "C" int SockeyeFileDigestFinal(unsigned char* digest, CC_SHA256_CTX*) {
  std::memset(digest, 42, CC_SHA256_DIGEST_LENGTH);
  return state.failure == 10 ? 0 : 1;
}
int main() {
  for (int failure = 0; failure <= 16; ++failure) {
    state = {};
    state.failure = failure;
    sockeye::FileIdentity identity;
    identity.canonical_path = "unchanged";
    std::string error;
    const bool success =
        sockeye::InspectExecutable("/example-file", identity, error);
    assert(success == (failure == 0 || failure == 8));
    assert(state.opens == state.closes);
    if (success) {
      assert(error.empty() && identity.canonical_path == "/example-file" &&
             identity.size == 3);
      assert(identity.digest[0] == 42 && identity.device == 7 &&
             identity.inode == 9);
      assert(state.reads == (failure == 8 ? 3 : 2));
    } else
      assert(!error.empty() && identity.canonical_path == "unchanged");
  }
  for (int failure : {1, 2, 3, 4}) {
    state = {};
    state.failure = failure;
    state.directory = true;
    sockeye::DirectoryIdentity identity;
    identity.canonical_path = "unchanged";
    std::string error;
    assert(!sockeye::InspectDirectory("/example-directory", identity, error));
    assert(state.opens == state.closes &&
           identity.canonical_path == "unchanged" && !error.empty());
  }
  return 0;
}
