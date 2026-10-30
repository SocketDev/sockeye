#include "approval-prompt.h"
#include "request-record.h"

#include <algorithm>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace {
void Event(const char* name) { std::fprintf(stderr, "effect:%s\n", name); }
} // namespace

namespace sockeye {

bool SaveRequestRecord(const RunOptions&, std::string_view request_id,
                       std::string& error) {
  assert(request_id.size() == 64);
  error.clear();
  Event("record");
  return true;
}

bool ExplainRequestRecord(std::string_view, FILE* output, std::string& error) {
  error.clear();
  Event("lookup");
  std::fputs("mock request details\n", output);
  return true;
}

bool IsRequestRecordId(std::string_view request_id) {
  constexpr std::string_view prefix = "sha256:";
  if (!request_id.starts_with(prefix)) {
    return false;
  }
  const std::string_view digest = request_id.substr(prefix.size());
  return digest.size() >= 16 && digest.size() <= 64 && digest.size() % 2 == 0 &&
         std::ranges::all_of(digest, [](unsigned char character) {
           return (character >= '0' && character <= '9') ||
                  (character >= 'a' && character <= 'f');
         });
}

bool ShowApprovalPrompt(const RunOptions&, std::string_view request_id,
                        AuthorizationContext& context, std::string_view reason,
                        KeychainError& error) {
  assert(request_id.size() == 64);
  Event("prompt");
  const char* scenario = std::getenv("SOCKEYE_TEST_SCENARIO");
  if (scenario != nullptr && std::string_view(scenario) == "prompt-cancelled") {
    error.status = KeychainStatus::kDenied;
    error.detail = "Approval cancelled.";
    return false;
  }
  return context.Authenticate(reason, error);
}

} // namespace sockeye
