#include "sockeye/readiness.h"
#include "sockeye/input-policy.h"
#include "sockeye/terminal.h"

#include <cstdio>

namespace sockeye {
namespace {

std::string ReadinessStatus(const KeychainError& error, bool credential) {
  switch (error.status) {
  case KeychainStatus::kSuccess:
    return "ready";
  case KeychainStatus::kNotFound:
    return credential ? "missing" : "unknown";
  case KeychainStatus::kInvalidPolicy:
    return credential ? "policy-mismatch" : "unknown";
  case KeychainStatus::kUnavailable:
    return "unavailable";
  default:
    return "unknown";
  }
}

} // namespace

std::string RenderReadinessReport(const ReadinessReport& report,
                                  std::string_view version) {
  std::string output =
      "platform: ready (macOS)\nversion: " + std::string(version) + "\n";
  output += report.foreground ? "foreground-terminal: ready\n"
                              : "foreground-terminal: unavailable; run from a "
                                "foreground terminal with a controlling tty\n";
  output += "biometry: " + ReadinessStatus(report.biometry, false) +
            " (os-code=" + std::to_string(report.biometry.os_status) + ")\n";
  if (report.biometry.status != KeychainStatus::kSuccess)
    output += "action: use Touch ID on an unlocked Mac with an enrolled "
              "fingerprint; retry unknown OS failures locally\n";
  if (report.has_credential) {
    output += "credential-policy: " + ReadinessStatus(report.credential, true) +
              " (os-code=" + std::to_string(report.credential.os_status) +
              ")\n";
    if (report.credential.status == KeychainStatus::kNotFound ||
        report.credential.status == KeychainStatus::kInvalidPolicy)
      output +=
          "action: run doctor --fix --credential NAME --binding BINDING_ID in "
          "a foreground terminal to enter and approve a replacement\n";
    else if (report.credential.status != KeychainStatus::kSuccess)
      output += "action: inspect Keychain access manually; ambiguous metadata "
                "cannot be repaired automatically\n";
  }
  output +=
      "Readiness does not establish authorization or release integrity.\n";
  return output;
}

int ReadinessExit(const ReadinessReport& report) {
  return report.foreground &&
                 report.biometry.status == KeychainStatus::kSuccess &&
                 (!report.has_credential ||
                  report.credential.status == KeychainStatus::kSuccess)
             ? 0
             : 5;
}

int RunDoctorCommand(int argc, char** argv, std::string_view version,
                     int (*repair)(std::string_view, std::string_view)) {
  bool fix = false;
  std::string_view credential;
  std::string_view binding_id;
  for (int index = 2; index < argc; ++index) {
    const std::string_view argument(argv[index]);
    if (argument == "--fix" && !fix)
      fix = true;
    else if (argument == "--credential" && credential.empty() &&
             index + 1 < argc) {
      credential = argv[++index];
      if (!IsEnvironmentName(credential) || ++index >= argc ||
          std::string_view(argv[index]) != "--binding" || ++index >= argc) {
        return 2;
      }
      binding_id = argv[index];
      if (!IsCredentialBindingId(binding_id))
        return 2;
    } else
      return 2;
  }
  ReadinessReport report;
  std::string terminal_error;
  report.foreground = HasForegroundTerminal(terminal_error);
  InspectBiometricReadiness(report.biometry);
  report.has_credential = !credential.empty();
  if (report.has_credential)
    InspectCredentialPolicy(binding_id, report.credential);
  if (fix && report.has_credential && report.foreground &&
      report.biometry.status == KeychainStatus::kSuccess &&
      (report.credential.status == KeychainStatus::kNotFound ||
       report.credential.status == KeychainStatus::kInvalidPolicy)) {
    std::fputs("repair: attended credential replacement requires hidden input "
               "and fresh Touch ID\n",
               stdout);
    const int result = repair(credential, binding_id);
    if (result != 0)
      return result;
    InspectCredentialPolicy(binding_id, report.credential);
  }
  const std::string output = RenderReadinessReport(report, version);
  std::fputs(output.c_str(), stdout);
  return ReadinessExit(report);
}

} // namespace sockeye
