#include "sockeye/input-policy.h"

#include <cstring>

namespace sockeye {

bool IsEnvironmentName(std::string_view value) {
  if (value.empty() || value.size() > kMaxEnvironmentNameBytes ||
      !(value.front() == '_' ||
        (value.front() >= 'A' && value.front() <= 'Z'))) {
    return false;
  }
  for (const char character : value) {
    if (!(character == '_' || (character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9'))) {
      return false;
    }
  }
  return true;
}

bool IsCredentialBindingId(std::string_view value) {
  if (value.size() != kCredentialBindingIdBytes)
    return false;
  for (const char character : value) {
    if (!((character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f'))) {
      return false;
    }
  }
  return true;
}

bool IsOnePasswordReference(std::string_view value) {
  return value.size() > 5 && value.size() <= kMaxOnePasswordReferenceBytes &&
         value.starts_with("op://") && !HasDisplayControl(value);
}

bool HasDisplayControl(std::string_view value) {
  for (const char raw_character : value) {
    const unsigned char character = static_cast<unsigned char>(raw_character);
    if (character < 0x20 || character == 0x7f) {
      return true;
    }
  }
  return false;
}

std::string VisibleArgument(std::string_view value) {
  std::string output;
  output.reserve(value.size());
  constexpr char kHex[] = "0123456789abcdef";
  for (const char raw_character : value) {
    const unsigned char character = static_cast<unsigned char>(raw_character);
    if (character >= 0x20 && character < 0x7f && character != '\\') {
      output.push_back(static_cast<char>(character));
      continue;
    }
    if (character == '\\') {
      output += "\\\\";
      continue;
    }
    output += "\\x";
    output.push_back(kHex[character >> 4]);
    output.push_back(kHex[character & 0x0f]);
  }
  return output;
}

void AppendCanonicalField(std::string& manifest, std::string_view name,
                          std::string_view value) {
  manifest += name;
  manifest += ':';
  manifest += std::to_string(value.size());
  manifest += ':';
  manifest.append(value);
  manifest += '\n';
}

bool IsCompleteSecretInput(const unsigned char* data, std::size_t size,
                           bool saw_terminator, bool trailing_bytes) {
  return saw_terminator && !trailing_bytes && size > 0 &&
         std::memchr(data, '\0', size) == nullptr;
}

} // namespace sockeye
