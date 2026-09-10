#include "sockeye/file-identity.h"
#include "sockeye/secret-buffer.h"

#include <cerrno>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <utility>

#include <CommonCrypto/CommonDigest.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace sockeye {
namespace {

constexpr std::uint64_t kMaxHashedFileBytes = 512ULL * 1024ULL * 1024ULL;

bool HasSafeOwnership(const struct stat &metadata) {
  return (metadata.st_uid == 0 || metadata.st_uid == geteuid()) &&
         (metadata.st_mode & (S_IWGRP | S_IWOTH)) == 0;
}

bool InspectFile(std::string_view path, bool require_executable,
                 FileIdentity &identity, std::string &error) {
  const std::string input(path);
  if (input.empty() || input.front() != '/') {
    error = "Child identity check failed: executable and bound-file paths must "
            "be absolute.";
    return false;
  }

  char resolved[PATH_MAX] = {};
  if (realpath(input.c_str(), resolved) == nullptr) {
    error =
        "Child identity check failed: could not resolve path before approval.";
    return false;
  }

  const int descriptor = open(resolved, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) {
    error = "Child identity check failed: could not open the resolved path "
            "without following a symlink.";
    return false;
  }

  struct stat metadata = {};
  if (fstat(descriptor, &metadata) != 0 || !S_ISREG(metadata.st_mode) ||
      !HasSafeOwnership(metadata)) {
    close(descriptor);
    error = "Child identity check failed: resolved path must be a regular file "
            "owned by root or the current user and not group/world writable.";
    return false;
  }
  if (require_executable &&
      (metadata.st_mode & (S_IXUSR | S_IXGRP | S_IXOTH)) == 0) {
    close(descriptor);
    error = "Child identity check failed: resolved child is not executable.";
    return false;
  }
  if (metadata.st_size < 0 ||
      static_cast<std::uint64_t>(metadata.st_size) > kMaxHashedFileBytes) {
    close(descriptor);
    error = "Child identity check failed: file size is outside the 0..512 MiB "
            "inspection limit.";
    return false;
  }

  CC_SHA256_CTX digest_context = {};
  if (CC_SHA256_Init(&digest_context) != 1) {
    close(descriptor);
    error = "Child identity check failed: SHA-256 initialization failed.";
    return false;
  }

  std::array<unsigned char, 65'536> chunk{};
  for (;;) {
    const ssize_t count = read(descriptor, chunk.data(), chunk.size());
    if (count == 0) {
      break;
    }
    if (count < 0) {
      if (errno == EINTR) {
        continue;
      }
      SecureZeroBytes(chunk.data(), chunk.size());
      close(descriptor);
      error = "Child identity check failed: could not read the complete file "
              "for SHA-256.";
      return false;
    }
    if (CC_SHA256_Update(&digest_context, chunk.data(),
                         static_cast<CC_LONG>(count)) != 1) {
      SecureZeroBytes(chunk.data(), chunk.size());
      close(descriptor);
      error = "Child identity check failed: SHA-256 update failed.";
      return false;
    }
  }
  SecureZeroBytes(chunk.data(), chunk.size());

  struct stat final_metadata = {};
  if (fstat(descriptor, &final_metadata) != 0 ||
      final_metadata.st_dev != metadata.st_dev ||
      final_metadata.st_ino != metadata.st_ino ||
      final_metadata.st_size != metadata.st_size ||
      final_metadata.st_mtimespec.tv_sec != metadata.st_mtimespec.tv_sec ||
      final_metadata.st_mtimespec.tv_nsec != metadata.st_mtimespec.tv_nsec) {
    SecureZeroBytes(&digest_context, sizeof(digest_context));
    close(descriptor);
    error =
        "Child identity check failed: file changed while Sockeye inspected it.";
    return false;
  }

  FileIdentity inspected;
  if (CC_SHA256_Final(inspected.digest.data(), &digest_context) != 1) {
    SecureZeroBytes(&digest_context, sizeof(digest_context));
    close(descriptor);
    error = "Child identity check failed: SHA-256 finalization failed.";
    return false;
  }
  SecureZeroBytes(&digest_context, sizeof(digest_context));
  close(descriptor);

  inspected.canonical_path = resolved;
  inspected.device = static_cast<std::uint64_t>(metadata.st_dev);
  inspected.inode = static_cast<std::uint64_t>(metadata.st_ino);
  inspected.modified_nanoseconds =
      static_cast<std::uint64_t>(metadata.st_mtimespec.tv_sec) *
          1'000'000'000ULL +
      static_cast<std::uint64_t>(metadata.st_mtimespec.tv_nsec);
  inspected.size = static_cast<std::uint64_t>(metadata.st_size);
  identity = std::move(inspected);
  return true;
}

} // namespace

bool InspectExecutable(std::string_view path, FileIdentity &identity,
                       std::string &error) {
  return InspectFile(path, true, identity, error);
}

bool InspectRegularFile(std::string_view path, FileIdentity &identity,
                        std::string &error) {
  return InspectFile(path, false, identity, error);
}

bool InspectDirectory(std::string_view path, DirectoryIdentity &identity,
                      std::string &error) {
  const std::string input(path);
  if (input.empty() || input.front() != '/') {
    error = "Manifest rejected: --cwd must be an absolute path.";
    return false;
  }
  char resolved[PATH_MAX] = {};
  if (realpath(input.c_str(), resolved) == nullptr) {
    error = "Manifest rejected: --cwd could not be resolved before approval.";
    return false;
  }
  const int descriptor =
      open(resolved, O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW);
  if (descriptor < 0) {
    error =
        "Manifest rejected: --cwd could not be opened safely before approval.";
    return false;
  }
  struct stat metadata = {};
  if (fstat(descriptor, &metadata) != 0 || !S_ISDIR(metadata.st_mode) ||
      !HasSafeOwnership(metadata)) {
    close(descriptor);
    error = "Manifest rejected: --cwd must be owned by root or the current "
            "user and not group/world writable.";
    return false;
  }
  close(descriptor);
  identity.canonical_path = resolved;
  identity.device = static_cast<std::uint64_t>(metadata.st_dev);
  identity.inode = static_cast<std::uint64_t>(metadata.st_ino);
  return true;
}

bool SameIdentity(const FileIdentity &left, const FileIdentity &right) {
  return left.canonical_path == right.canonical_path &&
         left.digest == right.digest && left.device == right.device &&
         left.inode == right.inode &&
         left.modified_nanoseconds == right.modified_nanoseconds &&
         left.size == right.size;
}

std::string DigestHex(const FileIdentity &identity) {
  constexpr char kHex[] = "0123456789abcdef";
  std::string output(identity.digest.size() * 2, '0');
  for (std::size_t index = 0; index < identity.digest.size(); ++index) {
    const unsigned char byte = identity.digest[index];
    output[index * 2] = kHex[byte >> 4];
    output[index * 2 + 1] = kHex[byte & 0x0f];
  }
  return output;
}

std::string DigestText(std::string_view value) {
  FileIdentity identity;
  CC_SHA256(value.data(), static_cast<CC_LONG>(value.size()),
            identity.digest.data());
  return DigestHex(identity);
}

} // namespace sockeye
