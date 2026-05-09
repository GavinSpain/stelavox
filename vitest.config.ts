import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'path'

/**
 * Vitest configuration — Phase 5b SU-44 close-out.
 *
 * Vitest handles unit-level tests of `lib/*` modules that Playwright
 * cannot run (Playwright fails on dynamic ESM import of project ESM
 * modules). Test files use `*.test.ts`; Playwright specs use `*.spec.ts`
 * — the two suites do not overlap.
 *
 * The `server-only` package throws on import unless inside a React
 * Server Component bundle; under Vitest we alias it to a no-op shim so
 * lib/director/executor.ts and lib/security/tool-validator.ts (which
 * declare `import 'server-only'` for client-bundle protection) can be
 * imported in unit tests.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      'server-only': resolve(__dirname, 'tests/unit/shims/server-only.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
    testTimeout: 30_000,
  },
})
