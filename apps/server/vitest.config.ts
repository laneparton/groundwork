import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry points and layer wiring run in the web integration test, not unit tests.
      exclude: [
        'src/**/*.test.ts',
        'src/test/**',
        'src/main.ts',
        'src/layers.ts',
        'src/auth/migrate.ts',
      ],
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80, perFile: true },
    },
  },
})
