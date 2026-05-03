// Supabase CLI v2 ships Mailpit (not Inbucket) as the local email server.
const MAILPIT_URL = 'http://localhost:54334'

interface MailpitMessage { ID: string }
interface MailpitSearchResult { messages: MailpitMessage[] | null }
interface MailpitDetail { Text: string; HTML: string }

async function searchMessages(email: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
  if (!res.ok) return []
  const data: MailpitSearchResult = await res.json()
  return data.messages ?? []
}

async function getMessage(id: string): Promise<MailpitDetail | null> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)
  if (!res.ok) return null
  return res.json()
}

async function deleteMessage(id: string) {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IDs: [id] }),
  })
}

export async function pollForLink(
  email: string,
  timeoutMs = 10_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const messages = await searchMessages(email)
    if (messages.length) {
      const msg = await getMessage(messages[0].ID)
      if (msg) {
        // Prefer plain-text body to avoid HTML-entity-encoded & in URLs
        const source = msg.Text || msg.HTML || ''
        const match = source.match(/href="([^"]*(?:confirm|recovery|magic)[^"]*)"/) ||
                      source.match(/(https?:\/\/[^\s"<>]+(?:confirm|recovery|magic)[^\s"<>]*)/)
        await deleteMessage(messages[0].ID)
        if (!match?.[1]) return null
        // Supabase local email templates use /verify path but Kong gateway only routes /auth/v1/verify
        let url = match[1]
        if (url.includes('/verify?') && !url.includes('/auth/v1/verify?')) {
          url = url.replace('/verify?', '/auth/v1/verify?')
        }
        return url
      }
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return null
}
