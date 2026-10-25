#ifndef SOCKEYE_SECRET_BUFFER_H
#define SOCKEYE_SECRET_BUFFER_H

#include <cstddef>
#include <memory>
#include <string>

namespace sockeye {

class SecretBuffer final {
public:
  static constexpr std::size_t kCapacity = 65'535;

  SecretBuffer();
  ~SecretBuffer();

  SecretBuffer(const SecretBuffer &) = delete;
  SecretBuffer &operator=(const SecretBuffer &) = delete;
  SecretBuffer(SecretBuffer &&) = delete;
  SecretBuffer &operator=(SecretBuffer &&) = delete;

  bool Assign(const void *source, std::size_t length);
  void Clear();
  bool CommitWrittenBytes(std::size_t length);
  unsigned char *Data();
  const unsigned char *Data() const;
  bool IsLocked() const;
  std::size_t Size() const;

private:
  std::unique_ptr<unsigned char[]> data_;
  bool locked_ = false;
  std::size_t size_ = 0;
};

void SecureClearString(std::string &value);
void SecureZeroBytes(void *value, std::size_t length);

} // namespace sockeye

#endif
