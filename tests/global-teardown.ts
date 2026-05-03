import { loadEnv } from './helpers/env'
import { adminClient } from './helpers/db'

const TEST_EMAILS = new Set([
  'test-a@example.com',
  'test-b@example.com',
  'test-c@example.com',
  'test-magic@example.com',
])

export default async function globalTeardown() {
  loadEnv()
  const admin = adminClient()
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
  for (const user of data?.users ?? []) {
    if (TEST_EMAILS.has(user.email!)) {
      await admin.auth.admin.deleteUser(user.id)
    }
  }
}
