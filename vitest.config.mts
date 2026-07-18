import { defineConfig } from 'vitest/config'

// oxlint-disable-next-line socket/no-default-export -- Vitest discovers this config through its default export.
export default defineConfig({
  test: {
    passWithNoTests: false,
  },
})
