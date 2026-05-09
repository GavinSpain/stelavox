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
    // Phase 5d Journey filters — `npx playwright test --project=j1` runs
    // only that Journey's spec files. The default `chromium` project still
    // runs the entire suite (Phase 1-5c plus all Phase 5d Journeys).
    { name: 'j1', testMatch: /tests[\\/]phase5d[\\/]j1-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'j2', testMatch: /tests[\\/]phase5d[\\/]j2-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'j3', testMatch: /tests[\\/]phase5d[\\/]j3.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'j4', testMatch: /tests[\\/]phase5d[\\/]j4-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'j5', testMatch: /tests[\\/]phase5d[\\/]j5-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'j6', testMatch: /tests[\\/]phase5d[\\/]j6-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'j7', testMatch: /tests[\\/]phase5d[\\/]j7-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'j8', testMatch: /tests[\\/]phase5d[\\/]j8-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'j9', testMatch: /tests[\\/]phase5d[\\/]j9-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'j10', testMatch: /tests[\\/]phase5d[\\/]j10-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // jb — UI sweep unlocked by SU-J3-5 data-testid additions; cross-Journey.
    { name: 'jb', testMatch: /tests[\\/]phase5d[\\/]jb-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Cloud-smoke project — runs only spec files tagged with @cloud, against
    // PLAYWRIGHT_APP_URL (set externally to https://stelavox.vercel.app).
    { name: 'cloud-smoke', grep: /@cloud/, use: { ...devices['Desktop Chrome'] } },
  ],
})
