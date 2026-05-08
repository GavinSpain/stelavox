export const USERS = {
  A: { email: 'test-a@example.com', password: 'Test1234!Test1234!', storageState: 'tests/.auth/test-a.json' },
  B: { email: 'test-b@example.com', password: 'Test1234!Test1234!', storageState: 'tests/.auth/test-b.json' },
  C: { email: 'test-c@example.com', password: 'Test1234!Test1234!', storageState: 'tests/.auth/test-c.json' },
  MAGIC: { email: 'test-magic@example.com', password: 'Test1234!Test1234!', storageState: 'tests/.auth/test-magic.json' },
} as const

export const APP_URL = process.env.PLAYWRIGHT_APP_URL ?? 'http://localhost:3000'
export const SUPABASE_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54331'
