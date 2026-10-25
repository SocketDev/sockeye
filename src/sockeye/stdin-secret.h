#ifndef SOCKEYE_STDIN_SECRET_H
#define SOCKEYE_STDIN_SECRET_H

#include <string>

#include "sockeye/secret-buffer.h"

namespace sockeye {

bool ReadSecretFromPipe(int descriptor, SecretBuffer& output,
                        std::string& error);

} // namespace sockeye

#endif
