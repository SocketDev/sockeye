#ifndef SOCKEYE_REQUEST_RECORD_H
#define SOCKEYE_REQUEST_RECORD_H

#include <cstdio>
#include <string>
#include <string_view>

#include "sockeye/run-request.h"

namespace sockeye {

bool SaveRequestRecord(const RunOptions& options, std::string_view request_id,
                       std::string& error);
bool ExplainRequestRecord(std::string_view request_id, FILE* output,
                          std::string& error);
bool IsRequestRecordId(std::string_view request_id);

} // namespace sockeye

#endif
