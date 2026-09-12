#include "sockeye/readiness.h"
#include "sockeye/terminal.h"

#include <cassert>
#include <string>
#include <vector>

namespace {
bool foreground = true;
sockeye::KeychainStatus biometry = sockeye::KeychainStatus::kSuccess;
sockeye::KeychainStatus policy = sockeye::KeychainStatus::kSuccess;
int probes = 0;
int repairs = 0;
int repair_exit = 0;
bool repair_effective = true;

int RepairCredential(std::string_view name) {
  assert(name == "EXAMPLE_TOKEN");
  ++repairs;
  if (repair_exit == 0 && repair_effective) policy = sockeye::KeychainStatus::kSuccess;
  return repair_exit;
}

int Doctor(std::vector<std::string> arguments) {
  std::vector<char *> argv;
  for (std::string &argument : arguments) argv.push_back(argument.data());
  return sockeye::RunDoctorCommand(static_cast<int>(argv.size()), argv.data(), "0.0.0", RepairCredential);
}
}

namespace sockeye {
bool HasForegroundTerminal(std::string &) { return foreground; }
KeychainStatus InspectBiometricReadiness(KeychainError &error) {
  error.status = biometry;
  return biometry;
}
KeychainStatus InspectCredentialPolicy(std::string_view name, KeychainError &error) {
  assert(name == "EXAMPLE_TOKEN");
  ++probes;
  error.status = policy;
  return policy;
}
}

int main() {
  using sockeye::KeychainStatus;
  const std::vector<std::string> diagnose{"sockeye", "doctor", "--credential", "EXAMPLE_TOKEN"};
  const std::vector<std::string> fix{"sockeye", "doctor", "--fix", "--credential", "EXAMPLE_TOKEN"};
  assert(Doctor({"sockeye", "doctor"}) == 0);
  assert(probes == 0 && repairs == 0);
  assert(Doctor(fix) == 0);
  assert(repairs == 0);
  policy = KeychainStatus::kNotFound;
  assert(Doctor(diagnose) == 5);
  assert(repairs == 0);
  assert(Doctor(fix) == 0);
  assert(repairs == 1);
  assert(Doctor(fix) == 0);
  assert(repairs == 1);
  policy = KeychainStatus::kInvalidPolicy;
  assert(Doctor(diagnose) == 5);
  assert(repairs == 1);
  assert(Doctor(fix) == 0);
  assert(repairs == 2);
  policy = KeychainStatus::kIo;
  assert(Doctor(fix) == 5);
  assert(repairs == 2);
  policy = KeychainStatus::kDenied;
  assert(Doctor(fix) == 5);
  assert(repairs == 2);
  policy = KeychainStatus::kNotFound;
  foreground = false;
  assert(Doctor(fix) == 5);
  foreground = true;
  biometry = KeychainStatus::kUnavailable;
  assert(Doctor(fix) == 5);
  biometry = KeychainStatus::kIo;
  assert(Doctor(fix) == 5);
  assert(repairs == 2);
  biometry = KeychainStatus::kSuccess;
  repair_exit = 3;
  assert(Doctor(fix) == 3);
  repair_exit = 0;
  repair_effective = false;
  assert(Doctor(fix) == 5);
  assert(Doctor({"sockeye", "doctor", "--fix", "--fix"}) == 2);
  assert(Doctor({"sockeye", "doctor", "--credential"}) == 2);
  assert(Doctor({"sockeye", "doctor", "--credential", "invalid"}) == 2);
  assert(Doctor({"sockeye", "doctor", "--credential", "EXAMPLE_TOKEN", "--credential", "EXAMPLE_TOKEN"}) == 2);
  assert(Doctor({"sockeye", "doctor", "--unknown"}) == 2);
  sockeye::ReadinessReport report;
  report.biometry = {KeychainStatus::kUnavailable, -8, ""};
  report.has_credential = true;
  report.credential = {KeychainStatus::kIo, -25308, ""};
  const std::string output = sockeye::RenderReadinessReport(report, "0.0.0");
  assert(output.find("os-code=-8") != std::string::npos);
  assert(output.find("os-code=-25308") != std::string::npos);
  return 0;
}
