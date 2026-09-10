#ifndef SOCKEYE_READINESS_H
#define SOCKEYE_READINESS_H

#include <string>
#include <string_view>
#include "sockeye/keychain.h"

namespace sockeye {

struct ReadinessReport {
  bool foreground = false;
  KeychainError biometry;
  bool has_credential = false;
  KeychainError credential;
};

std::string RenderReadinessReport(const ReadinessReport &report,
                                  std::string_view version);
int ReadinessExit(const ReadinessReport &report);
int RunDoctorCommand(int argc, char **argv, std::string_view version,
                     int (*repair)(std::string_view));

} // namespace sockeye
#endif
