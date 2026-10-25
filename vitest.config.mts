import { defineConfig } from 'vitest/config'

// Vitest discovers this config through its default export.
// oxlint-disable-next-line socket/no-default-export -- vitest config
export default defineConfig({
  test: {
    passWithNoTests: false,
  },
})
