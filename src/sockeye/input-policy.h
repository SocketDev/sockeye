#ifndef SOCKEYE_INPUT_POLICY_H
#define SOCKEYE_INPUT_POLICY_H

#include <cstddef>
#include <string>
#include <string_view>

namespace sockeye {

constexpr std::size_t kMaxEnvironmentNameBytes = 127;
constexpr std::size_t kCredentialBindingIdBytes = 64;
constexpr std::size_t kMaxOnePasswordReferenceBytes = 2'048;

bool IsEnvironmentName(std::string_view value);
bool IsCredentialBindingId(std::string_view value);
bool IsOnePasswordReference(std::string_view value);
bool HasDisplayControl(std::string_view value);
std::string VisibleArgument(std::string_view value);
void AppendCanonicalField(std::string& manifest, std::string_view name,
                          std::string_view value);
bool IsCompleteSecretInput(const unsigned char* data, std::size_t size,
                           bool saw_terminator, bool trailing_bytes);

} // namespace sockeye

#endif
