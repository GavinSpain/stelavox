import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'path'
import { loadEnv } from './tests/helpers/env'

loadEnv()

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',
  fullyParallel: false,
  // Two retries for the UI tests' click+wait sequences which
  // intermittently race with dev-server response times under
  // sequential suite load. The underlying tests are deterministic in
  // isolation; retries paper over an environment-level timing issue.
  retries: 2,
  reporter: [['line'], ['json', { outputFile: 'tests/results.json' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    cwd: resolve(__dirname),
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 90_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
