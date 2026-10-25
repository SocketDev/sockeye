#ifndef SOCKEYE_RUN_REQUEST_H
#define SOCKEYE_RUN_REQUEST_H

#include <cstdio>
#include <string>
#include <string_view>
#include <vector>

#include "file-identity.h"

namespace sockeye {

struct CredentialRequest {
  std::string binding_id;
  std::string identifier;
};

struct RunOptions {
  std::vector<FileIdentity> bound_files;
  std::vector<std::string> child_arguments;
  std::vector<CredentialRequest> credentials;
  FileIdentity executable;
  std::vector<std::string> passed_environment;
  DirectoryIdentity working_directory;
};

bool PrepareRunRequest(int argc, char** argv, RunOptions& options,
                       std::string& error);
std::string CanonicalRunManifest(const RunOptions& options);
std::string FormatRunRequest(const RunOptions& options, std::string_view digest,
                             bool preview);
void RenderRunRequest(FILE* stream, const RunOptions& options,
                      std::string_view digest, bool preview);

} // namespace sockeye

#endif
