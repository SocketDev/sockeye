#include "sockeye/child-process.h"
#include <cassert>
#include <cerrno>
#include <csignal>
#include <cstdarg>
#include <cstring>
#include <fcntl.h>
#include <set>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

namespace {
enum class Failure {
  None, ExecutableInspection, ExecutableMismatch, BoundInspection, BoundMismatch,
  DirectoryResolve, DirectoryMismatch, DirectoryOpen, DirectoryStat, DirectoryOwner,
  ActionsInit, ActionsDirectory, Pipe, FirstFlag, SecondFlag, Dup, CloseWrite,
  CloseRead, Spawn, WriteError, WriteZero, WriteInterrupt, WaitError, WaitInterrupt,
  Signal, UnsupportedStatus, NullKey, EmptyKey, DuplicateKey, DescriptorThree,
};
struct State {
  Failure failure = Failure::None;
  std::set<int> descriptors;
  bool actions = false;
  int flags = 0;
  int writes = 0;
  int waits = 0;
  int spawns = 0;
  std::vector<unsigned char> delivered;
} state;
constexpr int kDirectory = 50;
constexpr int kWrite = 62;
constexpr pid_t kChild = 501;
constexpr char kValue[] = "example-placeholder";
int ReadDescriptor() { return state.failure == Failure::DescriptorThree ? 3 : 61; }
sockeye::FileIdentity Approved(std::string_view path) {
  sockeye::FileIdentity identity; identity.canonical_path = path; return identity;
}
}
namespace sockeye {
bool InspectExecutable(std::string_view path, FileIdentity &identity, std::string &error) {
  if (state.failure == Failure::ExecutableInspection) { error = "example inspection failed"; return false; }
  identity = Approved(path); return true;
}
bool InspectRegularFile(std::string_view path, FileIdentity &identity, std::string &error) {
  if (state.failure == Failure::BoundInspection) { error = "example inspection failed"; return false; }
  identity = Approved(path); return true;
}
bool SameIdentity(const FileIdentity &left, const FileIdentity &) {
  return !(left.canonical_path == "/example-executable" ? state.failure == Failure::ExecutableMismatch : state.failure == Failure::BoundMismatch);
}
}
extern "C" char *SockeyeChildRealpath(const char *path, char *resolved) {
  if (state.failure == Failure::DirectoryResolve) return nullptr;
  std::strcpy(resolved, state.failure == Failure::DirectoryMismatch ? "/example-other-directory" : path);
  return resolved;
}
extern "C" int SockeyeChildOpen(const char *, int flags, ...) {
  assert((flags & (O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)) == (O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  if (state.failure == Failure::DirectoryOpen) return -1;
  assert(state.descriptors.insert(kDirectory).second); return kDirectory;
}
extern "C" int SockeyeChildStat(int descriptor, struct stat *metadata) {
  assert(descriptor == kDirectory);
  if (state.failure == Failure::DirectoryStat) return -1;
  *metadata = {}; metadata->st_mode = S_IFDIR | 0700; metadata->st_uid = geteuid();
  if (state.failure == Failure::DirectoryOwner) metadata->st_mode |= S_IWOTH;
  return 0;
}
extern "C" int SockeyeChildClose(int descriptor) {
  assert(state.descriptors.erase(descriptor) == 1); return 0;
}
extern "C" int SockeyeChildPipe(int descriptors[2]) {
  if (state.failure == Failure::Pipe) return -1;
  descriptors[0] = ReadDescriptor(); descriptors[1] = kWrite;
  assert(state.descriptors.insert(descriptors[0]).second);
  assert(state.descriptors.insert(descriptors[1]).second); return 0;
}
extern "C" int SockeyeChildFcntl(int descriptor, int command, ...) {
  assert(state.descriptors.contains(descriptor) && command == F_SETFD);
  va_list arguments; va_start(arguments, command);
  assert(va_arg(arguments, int) == FD_CLOEXEC);
  va_end(arguments);
  ++state.flags;
  return (state.flags == 1 && state.failure == Failure::FirstFlag) || (state.flags == 2 && state.failure == Failure::SecondFlag) ? -1 : 0;
}
extern "C" int SockeyeChildActionsInit(posix_spawn_file_actions_t *) {
  if (state.failure == Failure::ActionsInit) return ENOMEM;
  assert(!state.actions); state.actions = true; return 0;
}
extern "C" int SockeyeChildActionsDestroy(posix_spawn_file_actions_t *) {
  assert(state.actions); state.actions = false; return 0;
}
extern "C" int SockeyeChildActionsDirectory(posix_spawn_file_actions_t *, int descriptor) {
  assert(state.actions && descriptor == kDirectory);
  return state.failure == Failure::ActionsDirectory ? EBADF : 0;
}
extern "C" int SockeyeChildActionsDirectoryNp(posix_spawn_file_actions_t *actions, int descriptor) {
  return SockeyeChildActionsDirectory(actions, descriptor);
}
extern "C" int SockeyeChildActionsDup(posix_spawn_file_actions_t *, int descriptor, int destination) {
  assert(state.actions && descriptor == ReadDescriptor() && destination == 3);
  return state.failure == Failure::Dup ? EBADF : 0;
}
extern "C" int SockeyeChildActionsClose(posix_spawn_file_actions_t *, int descriptor) {
  assert(state.actions && (descriptor == kWrite || descriptor == ReadDescriptor()));
  return (descriptor == kWrite && state.failure == Failure::CloseWrite) || (descriptor == ReadDescriptor() && state.failure == Failure::CloseRead) ? EBADF : 0;
}
extern "C" int SockeyeChildSpawn(pid_t *child, const char *path, const posix_spawn_file_actions_t *, const posix_spawnattr_t *, char *const arguments[], char *const environment[]) {
  assert(state.actions && std::strcmp(path, "/example-executable") == 0);
  assert(std::strcmp(arguments[0], path) == 0 && std::strcmp(arguments[1], "example-argument") == 0 && arguments[2] == nullptr);
  std::vector<std::string> entries;
  for (std::size_t index = 0; environment[index] != nullptr; ++index) entries.emplace_back(environment[index]);
  assert((entries == std::vector<std::string>{"EXAMPLE_TOKEN=example-placeholder", "SOCKEYE_CREDENTIAL_PROTOCOL=envrypt-v1", "SOCKEYE_CREDENTIAL_FD=3"}));
  ++state.spawns; *child = kChild;
  return state.failure == Failure::Spawn ? EIO : 0;
}
extern "C" ssize_t SockeyeChildWrite(int descriptor, const void *data, size_t length) {
  assert(descriptor == kWrite && state.descriptors.contains(descriptor));
  ++state.writes;
  if (state.failure == Failure::WriteError) { errno = EIO; return -1; }
  if (state.failure == Failure::WriteZero) return 0;
  if (state.failure == Failure::WriteInterrupt && state.writes == 1) { errno = EINTR; return -1; }
  const auto *bytes = static_cast<const unsigned char *>(data);
  assert(length > 0); state.delivered.push_back(*bytes); return 1;
}
extern "C" pid_t SockeyeChildWait(pid_t child, int *status, int options) {
  assert(child == kChild && options == 0 && state.descriptors.empty() && !state.actions);
  ++state.waits;
  if (state.failure == Failure::WaitError) { errno = ECHILD; return -1; }
  if (state.failure == Failure::WaitInterrupt && state.waits == 1) { errno = EINTR; return -1; }
  *status = state.failure == Failure::Signal ? SIGTERM : state.failure == Failure::UnsupportedStatus ? ((SIGSTOP << 8) | 0x7f) : (23 << 8);
  return child;
}
int main() {
  for (int index = 0; index <= static_cast<int>(Failure::DescriptorThree); ++index) {
    state = {}; state.failure = static_cast<Failure>(index);
    sockeye::SecretBuffer value, environment_value;
    assert(environment_value.Assign(kValue, sizeof(kValue) - 1));
    if (state.failure != Failure::EmptyKey) assert(value.Assign(kValue, sizeof(kValue) - 1));
    std::vector<sockeye::CredentialValue> credentials = {{"EXAMPLE_TOKEN", &environment_value}, {"ENVRYPT_PRIVATE_KEY", state.failure == Failure::NullKey ? nullptr : &value}};
    if (state.failure == Failure::DuplicateKey) credentials.push_back(credentials.back());
    const sockeye::DirectoryIdentity directory = {"/example-directory", 0, 0};
    std::string error;
    const int result = sockeye::LaunchChild(Approved("/example-executable"), {Approved("/example-bound-file")}, {"example-argument"}, {}, credentials, directory, error);
    const bool success = state.failure == Failure::None || state.failure == Failure::WriteInterrupt || state.failure == Failure::WaitInterrupt || state.failure == Failure::DescriptorThree;
    const int expected = success ? 23 : state.failure == Failure::Signal ? 128 + SIGTERM : 6;
    assert(result == expected && error.empty() == (success || state.failure == Failure::Signal));
    assert(state.descriptors.empty() && !state.actions);
    if (state.spawns > 0) {
      for (const auto &credential : credentials) {
        if (credential.value != nullptr) assert(credential.value->Size() == 0);
      }
    }
    if (success || state.failure == Failure::Signal || state.failure == Failure::WaitError || state.failure == Failure::UnsupportedStatus) {
      std::vector<unsigned char> expected_bytes = {'E', 'V', '1', 1, 0, 19, 0, sizeof(kValue) - 1};
      const std::string name = "ENVRYPT_PRIVATE_KEY";
      expected_bytes[5] = static_cast<unsigned char>(name.size());
      expected_bytes.insert(expected_bytes.end(), name.begin(), name.end());
      expected_bytes.insert(expected_bytes.end(), kValue, kValue + sizeof(kValue) - 1);
      assert(state.delivered == expected_bytes);
    }
    if (state.failure == Failure::WaitInterrupt) assert(state.waits == 2);
  }
  return 0;
}
