#ifndef SOCKEYE_APPROVAL_PROMPT_H
#define SOCKEYE_APPROVAL_PROMPT_H

#include "run-request.h"
#include "keychain.h"

#include <string_view>

namespace sockeye {

bool ShowApprovalPrompt(const RunOptions& options, std::string_view request_id,
                        AuthorizationContext& context, std::string_view reason,
                        KeychainError& error);

} // namespace sockeye

#endif
