#include "sockeye/input-policy.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t *data,
                                      std::size_t size) {
  const auto *characters = reinterpret_cast<const char *>(data);
  const std::string_view input(characters, size);

  (void)sockeye::IsEnvironmentName(input);
  (void)sockeye::HasDisplayControl(input);
  const std::string visible = sockeye::VisibleArgument(input);
  assert(visible.size() <= size * 4);

  std::string manifest;
  sockeye::AppendCanonicalField(manifest, "fuzz", input);
  assert(manifest.size() >= size);

  const bool saw_terminator = size > 0 && (data[0] & 1U) != 0;
  const bool trailing_bytes = size > 0 && (data[0] & 2U) != 0;
  (void)sockeye::IsCompleteSecretInput(data, size, saw_terminator,
                                       trailing_bytes);
  return 0;
}
