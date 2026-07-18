#include "sockeye/secret-buffer.h"

#include <cstring>
#include <string>

#include <sys/mman.h>

namespace sockeye {

SecretBuffer::SecretBuffer()
    : data_(std::make_unique<unsigned char[]>(kCapacity)) {
  locked_ = mlock(data_.get(), kCapacity) == 0;
}

SecretBuffer::~SecretBuffer() {
  Clear();
  if (locked_) {
    munlock(data_.get(), kCapacity);
  }
}

bool SecretBuffer::Assign(const void *source, std::size_t length) {
  if (!locked_ || source == nullptr || length == 0 || length > kCapacity) {
    return false;
  }
  Clear();
  std::memcpy(data_.get(), source, length);
  size_ = length;
  return true;
}

void SecretBuffer::Clear() {
  SecureZeroBytes(data_.get(), kCapacity);
  size_ = 0;
}

bool SecretBuffer::CommitWrittenBytes(std::size_t length) {
  if (!locked_ || length == 0 || length > kCapacity) {
    Clear();
    return false;
  }
  size_ = length;
  return true;
}

unsigned char *SecretBuffer::Data() { return data_.get(); }

const unsigned char *SecretBuffer::Data() const { return data_.get(); }

bool SecretBuffer::IsLocked() const { return locked_; }

std::size_t SecretBuffer::Size() const { return size_; }

void SecureClearString(std::string &value) {
  if (!value.empty()) {
    SecureZeroBytes(value.data(), value.size());
  }
  value.clear();
}

void SecureZeroBytes(void *value, std::size_t length) {
  volatile unsigned char *cursor = static_cast<volatile unsigned char *>(value);
  while (length > 0) {
    *cursor = 0;
    ++cursor;
    --length;
  }
}

} // namespace sockeye
