// Vitest setup — loads .env.local for the integration-style unit tests
// that need a real Supabase connection (TC-S-02 etc.).

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
