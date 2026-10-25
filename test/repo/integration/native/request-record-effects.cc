#include "approval-prompt.h"
#include "request-record.h"

#include <cstdio>
#include <cstdlib>

namespace sockeye {

bool SaveRequestRecord(const RunOptions&, std::string_view request_id,
                       std::string&) {
  std::fprintf(stderr, "forbidden request record: sha256:%.*s\n",
               static_cast<int>(request_id.size()), request_id.data());
  std::exit(90);
}

bool ExplainRequestRecord(std::string_view, FILE*, std::string&) {
  std::exit(90);
}

bool IsRequestRecordId(std::string_view) { return false; }

bool ShowApprovalPrompt(const RunOptions&, std::string_view,
                        AuthorizationContext&, std::string_view,
                        KeychainError&) { std::exit(90); }

} // namespace sockeye
