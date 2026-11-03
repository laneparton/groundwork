import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests cover the plain TypeScript modules; React behavior is covered end to end in e2e/.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'src/features/conversations/api.ts',
        'src/features/conversations/chat-request.ts',
        'src/features/conversations/conversation-adapter.ts',
      ],
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
})
