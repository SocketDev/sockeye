#ifndef SOCKEYE_FILE_IDENTITY_H
#define SOCKEYE_FILE_IDENTITY_H

#include <array>
#include <cstdint>
#include <string>
#include <string_view>

namespace sockeye {

struct FileIdentity {
  std::string canonical_path;
  std::array<unsigned char, 32> digest{};
  std::uint64_t device = 0;
  std::uint64_t inode = 0;
  std::uint64_t modified_nanoseconds = 0;
  std::uint64_t size = 0;
};

struct DirectoryIdentity {
  std::string canonical_path;
  std::uint64_t device = 0;
  std::uint64_t inode = 0;
};

bool InspectExecutable(std::string_view path, FileIdentity& identity,
                       std::string& error);
bool InspectRegularFile(std::string_view path, FileIdentity& identity,
                        std::string& error);
bool InspectDirectory(std::string_view path, DirectoryIdentity& identity,
                      std::string& error);
bool SameIdentity(const FileIdentity& left, const FileIdentity& right);
std::string DigestHex(const FileIdentity& identity);
std::string DigestText(std::string_view value);

} // namespace sockeye

#endif
