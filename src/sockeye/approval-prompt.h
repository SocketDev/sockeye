#ifndef SOCKEYE_APPROVAL_PROMPT_H
#define SOCKEYE_APPROVAL_PROMPT_H

#include "sockeye/run-request.h"

#include <string_view>

namespace sockeye {

bool ShowApprovalPrompt(const RunOptions& options, std::string_view request_id);

} // namespace sockeye

#endif
