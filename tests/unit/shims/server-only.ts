// Test-only shim for the `server-only` package. The real package throws
// on import unless inside a React Server Component bundle; this no-op
// shim lets Vitest import lib/* modules that declare `import 'server-only'`.
//
// Aliased via vitest.config.ts. Production builds continue to use the
// real `server-only` package and its client-bundle protection.
export {}
