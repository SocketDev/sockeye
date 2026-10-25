#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>

int main(int argc, char** argv) {
  if (argc == 2 && std::strcmp(argv[1], "--foreground-terminal") == 0) {
    const int terminal = open("/dev/tty", O_RDWR | O_CLOEXEC);
    if (terminal < 0)
      return 2;
    const bool foreground =
        isatty(terminal) && tcgetpgrp(terminal) == getpgrp();
    close(terminal);
    return foreground ? 0 : 2;
  }
  if (argc != 2 || (std::strcmp(argv[1], "initial") != 0 &&
                    std::strcmp(argv[1], "replacement") != 0))
    return 2;
  const char* expected = std::strcmp(argv[1], "initial") == 0
                             ? "SOCKEYE_FAKE_LIFECYCLE_INITIAL"
                             : "SOCKEYE_FAKE_LIFECYCLE_REPLACEMENT";
  const char* value = std::getenv("SOCKEYE_TEST_LIFECYCLE_TOKEN");
  const bool matches = value != nullptr && std::strcmp(value, expected) == 0;
  std::puts(matches ? "fixture-match" : "fixture-mismatch");
  return matches ? 0 : 1;
}
