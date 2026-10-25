#include "request-record.h"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <pwd.h>
#include <string>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <ctime>
#include <ranges>
#include <vector>

#include "file-identity.h"

namespace sockeye {
namespace {

constexpr std::size_t kMaxRecordBytes = 64 * 1024;
constexpr std::size_t kMaxRecords = 128;
constexpr std::string_view kRecordPrefix = "sha256:";

std::string TestRequestRecordDirectoryOverride() {
#ifdef SOCKEYE_TESTING
  const char* test_directory = std::getenv("SOCKEYE_TEST_REQUEST_RECORD_DIR");
  if (test_directory != nullptr && test_directory[0] != '\0') {
    return test_directory;
  }
#endif
  return {};
}

std::string RequestRecordDirectory() {
  const std::string override = TestRequestRecordDirectoryOverride();
  if (!override.empty()) {
    return override;
  }
  const passwd* account = getpwuid(getuid());
  if (account == nullptr || account->pw_dir == nullptr) {
    return {};
  }
  return std::string(account->pw_dir) +
         "/Library/Application Support/Sockeye/requests";
}

bool EnsureDirectory(std::string_view path, bool require_private,
                     std::string& error) {
  const std::string directory(path);
  if (mkdir(directory.c_str(), 0700) != 0 && errno != EEXIST) {
    error = "Sockeye could not create the private request history directory.";
    return false;
  }
  struct stat metadata{};
  if (lstat(directory.c_str(), &metadata) != 0 || !S_ISDIR(metadata.st_mode) ||
      S_ISLNK(metadata.st_mode) || metadata.st_uid != getuid() ||
      (metadata.st_mode & 0022) != 0 ||
      (require_private && (metadata.st_mode & 0077) != 0)) {
    error = "Sockeye request history directory has unsafe ownership or "
            "permissions.";
    return false;
  }
  return true;
}

bool PrepareRequestRecordDirectory(std::string& directory, std::string& error) {
  const std::string override = TestRequestRecordDirectoryOverride();
  if (!override.empty()) {
    directory = override;
    return EnsureDirectory(directory, true, error);
  }
  directory = RequestRecordDirectory();
  if (directory.empty()) {
    error = "Sockeye could not locate this user's home directory.";
    return false;
  }
  const std::size_t home_length =
      directory.size() -
      std::string_view("/Library/Application Support/Sockeye/requests").size();
  const std::string app_support =
      directory.substr(0, home_length) + "/Library/Application Support";
  const std::string sockeye_directory = app_support + "/Sockeye";
  return EnsureDirectory(app_support, false, error) &&
         EnsureDirectory(sockeye_directory, true, error) &&
         EnsureDirectory(directory, true, error);
}

bool ValidateRequestRecordDirectory(std::string& directory,
                                    std::string& error) {
  const std::string override = TestRequestRecordDirectoryOverride();
  directory = override.empty() ? RequestRecordDirectory() : override;
  if (directory.empty()) {
    error = "Sockeye could not locate this user's home directory.";
    return false;
  }
  struct stat metadata{};
  if (lstat(directory.c_str(), &metadata) != 0 || !S_ISDIR(metadata.st_mode) ||
      S_ISLNK(metadata.st_mode) || metadata.st_uid != getuid() ||
      (metadata.st_mode & 0077) != 0) {
    error = "No saved Sockeye request matches that request ID.";
    return false;
  }
  return true;
}

std::string Visible(std::string_view value) {
  std::string result;
  for (const char raw_character : value) {
    const auto character = static_cast<unsigned char>(raw_character);
    switch (character) {
    case '\\':
      result += "\\\\";
      break;
    case '\n':
      result += "\\n";
      break;
    case '\r':
      result += "\\r";
      break;
    case '\t':
      result += "\\t";
      break;
    default:
      if (character < 0x20 || character == 0x7f) {
        constexpr char kHex[] = "0123456789abcdef";
        result += "\\x";
        result += kHex[character >> 4];
        result += kHex[character & 0x0f];
      } else {
        result += static_cast<char>(character);
      }
    }
  }
  return result;
}

bool WriteAll(int descriptor, std::string_view contents) {
  std::size_t written = 0;
  while (written < contents.size()) {
    const ssize_t result =
        write(descriptor, contents.data() + written, contents.size() - written);
    if (result <= 0) {
      return false;
    }
    written += static_cast<std::size_t>(result);
  }
  return true;
}

bool IsHex(std::string_view value) {
  return std::ranges::all_of(value, [](unsigned char character) {
    return (character >= '0' && character <= '9') ||
           (character >= 'a' && character <= 'f');
  });
}

bool ReadRecord(std::string_view path, std::string& contents,
                std::string& error) {
  const std::string record_path(path);
  const int descriptor =
      open(record_path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) {
    error = "Sockeye could not open the saved request record.";
    return false;
  }
  struct stat metadata{};
  if (fstat(descriptor, &metadata) != 0 || !S_ISREG(metadata.st_mode) ||
      metadata.st_uid != getuid() || metadata.st_nlink != 1 ||
      (metadata.st_mode & 0077) != 0 || metadata.st_size < 0 ||
      static_cast<std::size_t>(metadata.st_size) > kMaxRecordBytes) {
    close(descriptor);
    error = "Sockeye rejected the saved request record's file policy.";
    return false;
  }
  contents.resize(static_cast<std::size_t>(metadata.st_size));
  std::size_t offset = 0;
  while (offset < contents.size()) {
    const ssize_t result =
        read(descriptor, contents.data() + offset, contents.size() - offset);
    if (result <= 0) {
      close(descriptor);
      error = "Sockeye could not read the saved request record.";
      return false;
    }
    offset += static_cast<std::size_t>(result);
  }
  close(descriptor);
  return true;
}

bool MakeRecordCapacity(std::string_view directory, std::string_view keep_name,
                        std::string& error) {
  const std::string directory_path(directory);
  DIR* entries = opendir(directory_path.c_str());
  if (entries == nullptr) {
    error = "Sockeye could not inspect its request history.";
    return false;
  }
  struct RecordEntry {
    std::string name;
    std::time_t modified;
  };
  std::vector<RecordEntry> records;
  while (const dirent* entry = readdir(entries)) {
    const std::string_view name(entry->d_name);
    if (name.size() != 64 || !IsHex(name) || name == keep_name) {
      continue;
    }
    const std::string path = directory_path + "/" + std::string(name);
    struct stat metadata{};
    if (lstat(path.c_str(), &metadata) == 0 && S_ISREG(metadata.st_mode) &&
        metadata.st_uid == getuid() && (metadata.st_mode & 0077) == 0) {
      records.push_back({std::string(name), metadata.st_mtime});
    }
  }
  closedir(entries);
  if (records.size() < kMaxRecords) {
    return true;
  }
  std::ranges::sort(records, {}, &RecordEntry::modified);
  const std::size_t remove_count = records.size() - kMaxRecords + 1;
  for (std::size_t index = 0; index < remove_count; ++index) {
    const std::string path = directory_path + "/" + records[index].name;
    if (unlink(path.c_str()) != 0) {
      error = "Sockeye could not prune old request details.";
      return false;
    }
  }
  return true;
}

} // namespace

bool IsRequestRecordId(std::string_view request_id) {
  if (!request_id.starts_with(kRecordPrefix)) {
    return false;
  }
  const std::string_view digest = request_id.substr(kRecordPrefix.size());
  return digest.size() >= 16 && digest.size() <= 64 && digest.size() % 2 == 0 &&
         IsHex(digest);
}

bool SaveRequestRecord(const RunOptions& options, std::string_view request_id,
                       std::string& error) {
  if (request_id.size() != 64 || !IsHex(request_id)) {
    error = "Sockeye request record needs a full SHA-256 request ID.";
    return false;
  }
  std::string directory;
  if (!PrepareRequestRecordDirectory(directory, error)) {
    return false;
  }
  if (!MakeRecordCapacity(directory, request_id, error)) {
    return false;
  }

  std::string contents = "Sockeye request details\nrequestId: sha256:";
  contents += request_id;
  contents += "\ncwd: ";
  contents += Visible(options.working_directory.canonical_path);
  contents += "\nexecutable: ";
  contents += Visible(options.executable.canonical_path);
  contents += "\nexecutable sha256: ";
  contents += DigestHex(options.executable);
  for (const FileIdentity& file : options.bound_files) {
    contents += "\nbound file: ";
    contents += Visible(file.canonical_path);
    contents += "\n  sha256: ";
    contents += DigestHex(file);
  }
  for (const CredentialRequest& credential : options.credentials) {
    contents += "\ncredential: ";
    contents += Visible(credential.identifier);
    contents += "\n  binding: ";
    contents += Visible(credential.binding_id);
  }
  for (const std::string& name : options.passed_environment) {
    contents += "\npass parent env: ";
    contents += Visible(name);
  }
  contents += "\nargument count: ";
  contents += std::to_string(options.child_arguments.size());
  contents += "\nRaw arguments and environment values are not stored.\n";
  if (contents.size() > kMaxRecordBytes) {
    error = "Sockeye request details exceeded the record size limit.";
    return false;
  }

  const std::string path = directory + "/" + std::string(request_id);
  const int descriptor =
      open(path.c_str(), O_WRONLY | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (descriptor < 0) {
    error = "Sockeye could not save private request details.";
    return false;
  }
  struct stat metadata{};
  const bool safe_file =
      fstat(descriptor, &metadata) == 0 && S_ISREG(metadata.st_mode) &&
      metadata.st_uid == getuid() && metadata.st_nlink == 1 &&
      fchmod(descriptor, 0600) == 0 && ftruncate(descriptor, 0) == 0;
  const bool saved =
      safe_file && WriteAll(descriptor, contents) && fsync(descriptor) == 0;
  close(descriptor);
  if (!saved) {
    error = "Sockeye could not safely write private request details.";
    return false;
  }
  return true;
}

bool ExplainRequestRecord(std::string_view request_id, FILE* output,
                          std::string& error) {
  if (!IsRequestRecordId(request_id)) {
    error = "Request ID must be sha256: followed by 16 to 64 lowercase hex "
            "characters.";
    return false;
  }
  std::string directory;
  if (!ValidateRequestRecordDirectory(directory, error)) {
    return false;
  }

  const std::string_view digest = request_id.substr(kRecordPrefix.size());
  DIR* entries = opendir(directory.c_str());
  if (entries == nullptr) {
    error = "No saved Sockeye request matches that request ID.";
    return false;
  }
  std::string match;
  bool ambiguous = false;
  while (const dirent* entry = readdir(entries)) {
    const std::string_view name(entry->d_name);
    if (name.size() == 64 && name.starts_with(digest) && IsHex(name)) {
      if (!match.empty()) {
        ambiguous = true;
        break;
      }
      match = name;
    }
  }
  closedir(entries);
  if (ambiguous) {
    error = "That shortened request ID matches more than one saved request; "
            "use the full requestId.";
    return false;
  }
  if (match.empty()) {
    error = "No saved Sockeye request matches that request ID.";
    return false;
  }
  std::string contents;
  if (!ReadRecord(directory + "/" + match, contents, error)) {
    return false;
  }
  const std::string expected =
      "Sockeye request details\nrequestId: sha256:" + match + "\n";
  if (!contents.starts_with(expected)) {
    error = "Sockeye rejected the saved request record's ID.";
    return false;
  }
  if (std::fwrite(contents.data(), 1, contents.size(), output) !=
      contents.size()) {
    error = "Sockeye could not print the saved request details.";
    return false;
  }
  return true;
}

} // namespace sockeye
