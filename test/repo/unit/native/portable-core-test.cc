#include "child-process.h"
#include "file-identity.h"
#include "secret-buffer.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <fcntl.h>
#include <limits.h>
#include <sys/stat.h>
#include <unistd.h>

namespace {
class Fixture final {
public:
  Fixture() {
    char pattern[] = "/private/tmp/sockeye-portable-core.XXXXXX";
    const char* created = mkdtemp(pattern);
    assert(created != nullptr);
    directory = created;
    file = directory + "/example-file";
    descriptor = open(file.c_str(), O_CREAT | O_EXCL | O_RDWR, 0600);
    assert(descriptor >= 0);
    assert(write(descriptor, "abc", 3) == 3);
  }
  ~Fixture() {
    assert(close(descriptor) == 0);
    assert(unlink(file.c_str()) == 0);
    assert(rmdir(directory.c_str()) == 0);
  }
  std::string directory;
  std::string file;
  int descriptor = -1;
};

void CheckBuffer() {
  sockeye::SecretBuffer buffer;
  assert(buffer.IsLocked());
  constexpr char bytes[] = "example-buffer-bytes";
  assert(!buffer.Assign(nullptr, 1));
  assert(!buffer.Assign(bytes, 0));
  assert(!buffer.Assign(bytes, sockeye::SecretBuffer::kCapacity + 1));
  assert(buffer.Assign(bytes, sizeof(bytes)));
  const sockeye::SecretBuffer& view = buffer;
  assert(view.Size() == sizeof(bytes));
  assert(std::memcmp(view.Data(), bytes, sizeof(bytes)) == 0);
  buffer.Clear();
  assert(buffer.Size() == 0);
  assert(std::all_of(buffer.Data(),
                     buffer.Data() + sockeye::SecretBuffer::kCapacity,
                     [](unsigned char value) { return value == 0; }));
  std::memcpy(buffer.Data(), bytes, sizeof(bytes));
  assert(buffer.CommitWrittenBytes(sizeof(bytes)));
  assert(buffer.Size() == sizeof(bytes));
  assert(!buffer.CommitWrittenBytes(0));
  assert(buffer.Size() == 0);
  assert(buffer.Data()[0] == 0);
  buffer.Data()[0] = 7;
  assert(!buffer.CommitWrittenBytes(sockeye::SecretBuffer::kCapacity + 1));
  assert(buffer.Data()[0] == 0);
  std::string text = bytes;
  sockeye::SecureClearString(text);
  assert(text.empty());
  sockeye::SecureClearString(text);
  unsigned char value = 7;
  sockeye::SecureZeroBytes(&value, 0);
  assert(value == 7);
  sockeye::SecureZeroBytes(&value, 1);
  assert(value == 0);
}

void CheckFiles(Fixture& fixture) {
  sockeye::FileIdentity identity;
  sockeye::DirectoryIdentity directory;
  std::string error;
  assert(!sockeye::InspectRegularFile("", identity, error));
  assert(!sockeye::InspectRegularFile("relative", identity, error));
  assert(!sockeye::InspectRegularFile(fixture.directory + "/missing", identity,
                                      error));
  assert(!sockeye::InspectRegularFile(fixture.directory, identity, error));
  assert(!sockeye::InspectExecutable(fixture.file, identity, error));
  assert(sockeye::InspectRegularFile(fixture.file, identity, error));
  assert(sockeye::DigestHex(identity) ==
         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert(identity.size == 3);
  assert(sockeye::SameIdentity(identity, identity));
  auto changed = identity;
  changed.canonical_path += "different";
  assert(!sockeye::SameIdentity(identity, changed));
  changed = identity;
  changed.digest[0] ^= 1;
  assert(!sockeye::SameIdentity(identity, changed));
  changed = identity;
  ++changed.device;
  assert(!sockeye::SameIdentity(identity, changed));
  changed = identity;
  ++changed.inode;
  assert(!sockeye::SameIdentity(identity, changed));
  changed = identity;
  ++changed.modified_nanoseconds;
  assert(!sockeye::SameIdentity(identity, changed));
  changed = identity;
  ++changed.size;
  assert(!sockeye::SameIdentity(identity, changed));
  assert(chmod(fixture.file.c_str(), 0660) == 0);
  assert(!sockeye::InspectRegularFile(fixture.file, identity, error));
  assert(chmod(fixture.file.c_str(), 0600) == 0);
  assert(ftruncate(fixture.descriptor, 512LL * 1024LL * 1024LL + 1) == 0);
  assert(!sockeye::InspectRegularFile(fixture.file, identity, error));
  assert(ftruncate(fixture.descriptor, 3) == 0);
  assert(!sockeye::InspectDirectory("", directory, error));
  assert(!sockeye::InspectDirectory("relative", directory, error));
  assert(!sockeye::InspectDirectory(fixture.directory + "/missing", directory,
                                    error));
  assert(!sockeye::InspectDirectory(fixture.file, directory, error));
  assert(chmod(fixture.directory.c_str(), 0770) == 0);
  assert(!sockeye::InspectDirectory(fixture.directory, directory, error));
  assert(chmod(fixture.directory.c_str(), 0700) == 0);
  assert(sockeye::InspectDirectory(fixture.directory, directory, error));
  assert(directory.canonical_path == fixture.directory);
}

void CheckLaunch(Fixture& fixture, const char* program) {
  char self_path[PATH_MAX] = {};
  assert(realpath(program, self_path) != nullptr);
  sockeye::FileIdentity self;
  sockeye::FileIdentity bound;
  sockeye::DirectoryIdentity directory;
  std::string error;
  assert(sockeye::InspectExecutable(self_path, self, error));
  assert(sockeye::InspectRegularFile(fixture.file, bound, error));
  assert(sockeye::InspectDirectory(fixture.directory, directory, error));
  assert(setenv("SOCKEYE_EXAMPLE_ALLOWED", "example-public-value", 1) == 0);
  assert(setenv("SOCKEYE_EXAMPLE_HIDDEN", "example-hidden-value", 1) == 0);
  assert(sockeye::LaunchChild(
             self, {bound}, {"--verify-context", fixture.directory},
             {"SOCKEYE_EXAMPLE_ALLOWED"}, {}, directory, error) == 0);
  assert(sockeye::LaunchChild(self, {}, {"--exit"}, {}, {}, directory, error) ==
         42);
  assert(sockeye::LaunchChild(self, {}, {"--signal"}, {}, {}, directory,
                              error) == 128 + SIGTERM);
  assert(unsetenv("SOCKEYE_EXAMPLE_ALLOWED") == 0);
  error.clear();
  assert(sockeye::LaunchChild(self, {}, {}, {"SOCKEYE_EXAMPLE_ALLOWED"}, {},
                              directory, error) == 6);
  assert(!error.empty());
  assert(unsetenv("SOCKEYE_EXAMPLE_HIDDEN") == 0);
  error.clear();
  auto invalid_directory = directory;
  ++invalid_directory.inode;
  assert(sockeye::LaunchChild(self, {}, {}, {}, {}, invalid_directory, error) ==
         6);
  invalid_directory.canonical_path = fixture.directory + "/missing";
  assert(sockeye::LaunchChild(self, {}, {}, {}, {}, invalid_directory, error) ==
         6);
  sockeye::SecretBuffer empty;
  for (sockeye::SecretBuffer* value :
       {static_cast<sockeye::SecretBuffer*>(nullptr), &empty}) {
    error.clear();
    assert(sockeye::LaunchChild(self, {}, {}, {},
                                {{"SOCKET_TEST_TOKEN", value}}, directory,
                                error) == 6);
  }
  const char nul_bytes[] = {'a', '\0', 'b'};
  assert(empty.Assign(nul_bytes, sizeof(nul_bytes)));
  assert(sockeye::LaunchChild(self, {}, {}, {}, {{"SOCKET_TEST_TOKEN", &empty}},
                              directory, error) == 6);
  assert(chmod(fixture.file.c_str(), 0700) == 0);
  sockeye::FileIdentity invalid_format;
  assert(sockeye::InspectExecutable(fixture.file, invalid_format, error));
  error.clear();
  assert(sockeye::LaunchChild(invalid_format, {}, {}, {}, {}, directory,
                              error) == 6);
  assert(!error.empty());
}
} // namespace

int main(int argc, char** argv) {
  if (argc >= 2) {
    const std::string mode = argv[1];
    if (mode == "--exit")
      return 42;
    if (mode == "--signal") {
      raise(SIGTERM);
      return 1;
    }
    if (mode == "--verify-context" && argc == 3) {
      char cwd[PATH_MAX] = {};
      const char* allowed = std::getenv("SOCKEYE_EXAMPLE_ALLOWED");
      return getcwd(cwd, sizeof(cwd)) != nullptr &&
                     std::string(cwd) == argv[2] && allowed != nullptr &&
                     std::string(allowed) == "example-public-value" &&
                     std::getenv("SOCKEYE_EXAMPLE_HIDDEN") == nullptr
                 ? 0
                 : 1;
    }
    return 1;
  }
  Fixture fixture;
  CheckBuffer();
  CheckFiles(fixture);
  CheckLaunch(fixture, argv[0]);
  return 0;
}
