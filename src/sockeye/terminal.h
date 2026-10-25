#ifndef SOCKEYE_TERMINAL_H
#define SOCKEYE_TERMINAL_H

#include <string>
#include <string_view>

#include "sockeye/secret-buffer.h"

namespace sockeye {

bool HasForegroundTerminal(std::string &error);
bool ReadSecretFromTerminal(std::string_view identifier, SecretBuffer &output,
                            std::string &error);

} // namespace sockeye

#endif
