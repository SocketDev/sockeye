#ifndef SOCKEYE_RUN_REQUEST_H
#define SOCKEYE_RUN_REQUEST_H

#include <cstdio>
#include <string>
#include <string_view>
#include <vector>

#include "sockeye/file-identity.h"

namespace sockeye {

struct RunOptions {
  std::vector<FileIdentity> bound_files;
  std::vector<std::string> child_arguments;
  std::vector<std::string> credential_names;
  FileIdentity executable;
  std::vector<std::string> passed_environment;
  DirectoryIdentity working_directory;
};

bool PrepareRunRequest(int argc, char **argv, RunOptions &options,
                       std::string &error);
std::string CanonicalRunManifest(const RunOptions &options);
void RenderRunRequest(FILE *stream, const RunOptions &options,
                      std::string_view digest, bool preview);

} // namespace sockeye

#endif
