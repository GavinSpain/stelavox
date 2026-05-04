import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Load env from .env.local
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').reduce((acc, line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) acc[m[1]] = m[2].replace(/^["']|["']$/g, '')
    return acc
  }, {})

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const EMAIL = 'gavin@example.com'
const PASSWORD = 'Stelavox1!Stelavox1!'

// Delete any existing user with this email so we can re-create cleanly
const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 200 })
for (const u of existing?.users ?? []) {
  if (u.email === EMAIL) {
    await supabase.auth.admin.deleteUser(u.id)
    console.log('Removed existing user:', u.id)
  }
}

const { data: created, error } = await supabase.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { display_name: 'Gavin' },
})
if (error) {
  console.error('Create failed:', error)
  process.exit(1)
}

// Verify org membership
const { data: membership } = await supabase
  .from('organisation_members')
  .select('organisation_id, role, organisations(name)')
  .eq('user_id', created.user.id)
  .maybeSingle()

console.log('User:', created.user.email)
console.log('Password:', PASSWORD)
console.log('Membership:', membership)
