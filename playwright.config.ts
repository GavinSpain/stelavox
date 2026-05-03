import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'path'
import { loadEnv } from './tests/helpers/env'

loadEnv()

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',
  fullyParallel: false,
  retries: 0,
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
