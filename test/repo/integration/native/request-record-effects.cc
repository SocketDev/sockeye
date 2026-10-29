#include "sockeye/approval-prompt.h"
#include "sockeye/request-record.h"

#include <cstdlib>

namespace sockeye {

bool SaveRequestRecord(const RunOptions&, std::string_view, std::string&) {
  std::exit(90);
}

bool ExplainRequestRecord(std::string_view, FILE*, std::string&) {
  std::exit(90);
}

bool IsRequestRecordId(std::string_view) { return false; }

bool ShowApprovalPrompt(const RunOptions&, std::string_view) { std::exit(90); }

} // namespace sockeye
