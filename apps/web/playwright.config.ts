import { defineConfig, devices } from '@playwright/test'

// Ports apart from `npm run dev`, so the suite runs beside a local dev stack.
const ports = { web: 5174, server: 3101, model: 4011 }
const web = `http://localhost:${ports.web}`
const isCI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // A test that only passes on retry fails the run: flakiness here has meant a real race.
  failOnFlakyTests: isCI,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: web, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/fake-openai.ts',
      port: ports.model,
      env: { FAKE_OPENAI_PORT: String(ports.model) },
      reuseExistingServer: false,
    },
    {
      // A fresh database per run; no .env, so local secrets and data stay out of tests.
      command: 'rm -f .data/e2e.sqlite && node src/auth/migrate.ts && node src/main.ts',
      cwd: '../server',
      stdout: 'pipe',
      url: `http://127.0.0.1:${ports.server}/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(ports.server),
        DATABASE_PATH: '.data/e2e.sqlite',
        BETTER_AUTH_SECRET: 'e2e-secret-that-is-at-least-32-characters',
        BETTER_AUTH_URL: web,
        AUTH_TRUSTED_ORIGINS: web,
        OPENAI_API_KEY: 'e2e',
        OPENAI_BASE_URL: `http://127.0.0.1:${ports.model}/v1`,
        CHAT_MODEL: 'fake-model',
      },
    },
    {
      command: `vite --port ${ports.web} --strictPort`,
      url: web,
      reuseExistingServer: false,
      env: { GROUNDWORK_SERVER_URL: `http://127.0.0.1:${ports.server}` },
    },
  ],
})
