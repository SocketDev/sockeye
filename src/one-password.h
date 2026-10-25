#ifndef SOCKEYE_ONE_PASSWORD_H
#define SOCKEYE_ONE_PASSWORD_H

#include <string>
#include <string_view>

#include "secret-buffer.h"

namespace sockeye {

// Reads one explicit op:// reference into locked memory. This is a setup-only
// import primitive: Sockeye never resolves 1Password references while running
// an approved child manifest.
bool ReadOnePasswordReference(std::string_view reference, SecretBuffer& output,
                              std::string& error);

} // namespace sockeye

#endif
