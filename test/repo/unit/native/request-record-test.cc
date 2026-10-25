#include "sockeye/request-record.h"

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

namespace {

std::string ReadOutput(FILE* output) {
  assert(std::fflush(output) == 0);
  assert(std::fseek(output, 0, SEEK_SET) == 0);
  std::string result;
  char buffer[512];
  while (const std::size_t count =
             std::fread(buffer, 1, sizeof(buffer), output)) {
    result.append(buffer, count);
  }
  return result;
}

void Save(const sockeye::RunOptions& options, std::string_view request_id) {
  std::string error;
  assert(sockeye::SaveRequestRecord(options, request_id, error));
  assert(error.empty());
}

} // namespace

int main() {
  char directory[] = "/tmp/sockeye-request-record-XXXXXX";
  assert(mkdtemp(directory) != nullptr);
  assert(chmod(directory, 0700) == 0);
  assert(setenv("SOCKEYE_TEST_REQUEST_RECORD_DIR", directory, 1) == 0);

  sockeye::RunOptions options;
  options.working_directory.canonical_path = "/tmp/example-worktree";
  options.executable.canonical_path = "/usr/bin/pnpm";
  options.credentials.push_back({std::string(64, 'b'), "GH_TOKEN"});
  options.passed_environment.push_back("HOME");
  options.child_arguments = {"--exec", "secret-argument-not-persisted"};
  Save(options, std::string(64, 'a'));

  struct stat directory_metadata{};
  assert(stat(directory, &directory_metadata) == 0);
  assert((directory_metadata.st_mode & 0777) == 0700);
  const std::string record_path =
      std::string(directory) + "/" + std::string(64, 'a');
  struct stat record_metadata{};
  assert(stat(record_path.c_str(), &record_metadata) == 0);
  assert((record_metadata.st_mode & 0777) == 0600);

  FILE* output = std::tmpfile();
  assert(output != nullptr);
  std::string error;
  assert(sockeye::ExplainRequestRecord("sha256:" + std::string(16, 'a'), output,
                                       error));
  const std::string details = ReadOutput(output);
  assert(details.find("requestId: sha256:" + std::string(64, 'a')) !=
         std::string::npos);
  assert(details.find("credential: GH_TOKEN") != std::string::npos);
  assert(details.find("binding: " + std::string(64, 'b')) != std::string::npos);
  assert(details.find("argument count: 2") != std::string::npos);
  assert(details.find("secret-argument-not-persisted") == std::string::npos);
  assert(details.find("Raw arguments and environment values are not stored.") !=
         std::string::npos);
  std::fclose(output);

  sockeye::RunOptions duplicate = options;
  duplicate.child_arguments = {"second request"};
  Save(duplicate, std::string(16, 'a') + std::string(48, 'c'));
  output = std::tmpfile();
  assert(output != nullptr);
  assert(!sockeye::ExplainRequestRecord("sha256:" + std::string(16, 'a'),
                                        output, error));
  assert(error.find("more than one") != std::string::npos);
  std::fclose(output);

  output = std::tmpfile();
  assert(output != nullptr);
  assert(!sockeye::ExplainRequestRecord("sha256:xyz", output, error));
  assert(error.find("lowercase hex") != std::string::npos);
  std::fclose(output);

  unsetenv("SOCKEYE_TEST_REQUEST_RECORD_DIR");
  assert(unlink(record_path.c_str()) == 0);
  const std::string second_path = std::string(directory) + "/" +
                                  std::string(16, 'a') + std::string(48, 'c');
  assert(unlink(second_path.c_str()) == 0);
  assert(rmdir(directory) == 0);
  return 0;
}
