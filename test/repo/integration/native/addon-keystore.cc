#include "socketsecurity/keystore-infra/keystore.h"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>

namespace {
std::map<std::string, std::string> items;
unsigned int calls = 0;
int Status(const char* service) {
  if (std::strcmp(service, "example-denied") == 0)
    return KEYSTORE_ERR_DENIED;
  if (std::strcmp(service, "example-unavailable") == 0)
    return KEYSTORE_ERR_UNAVAILABLE;
  if (std::strcmp(service, "example-io") == 0)
    return KEYSTORE_ERR_IO;
  return KEYSTORE_OK;
}
std::string Key(const char* service, const char* account) {
  assert(std::strlen(service) < 256 && std::strlen(account) < 256);
  return std::string(service) + '\n' + account;
}
} // namespace
extern "C" int keystore_get(const char* service, const char* account, char* out,
                            size_t capacity) {
  if (std::strcmp(service, "example-call-count") == 0) {
    std::snprintf(out, capacity, "%u", calls);
    return KEYSTORE_OK;
  }
  ++calls;
  const int status = Status(service);
  if (status != KEYSTORE_OK)
    return status;
  const auto item = items.find(Key(service, account));
  if (item == items.end())
    return KEYSTORE_ERR_NOT_FOUND;
  assert(item->second.size() < capacity);
  std::memcpy(out, item->second.c_str(), item->second.size() + 1);
  return KEYSTORE_OK;
}
extern "C" int keystore_put(const char* service, const char* account,
                            const char* value) {
  ++calls;
  const int status = Status(service);
  if (status != KEYSTORE_OK)
    return status;
  assert(std::strlen(value) < 8192);
  items[Key(service, account)] = value;
  return KEYSTORE_OK;
}
extern "C" int keystore_delete(const char* service, const char* account) {
  ++calls;
  const int status = Status(service);
  if (status != KEYSTORE_OK)
    return status;
  items.erase(Key(service, account));
  return KEYSTORE_OK;
}
