import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/services/**/*.ts', 'src/routes/**/*.ts', 'src/admin/**/*.ts', 'src/app/**/*.ts'],
      exclude: ['**/__tests__/**'],
    },
  },
})
