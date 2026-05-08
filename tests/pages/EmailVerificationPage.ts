import { Page } from '@playwright/test'
import { pollForLink } from '../helpers/inbucket'

/**
 * EmailVerificationPage wraps Mailpit polling + visiting the link.
 * Phase 5d treats Mailpit as a third-party surface; this POM keeps the
 * spec free of inbucket plumbing.
 */
export class EmailVerificationPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async pollForLinkOrThrow(email: string, timeoutMs = 15_000): Promise<string> {
    const link = await pollForLink(email, timeoutMs)
    if (!link) throw new Error(`No verification link arrived for ${email} within ${timeoutMs}ms`)
    return link
  }

  async pollForLinkOrNull(email: string, timeoutMs = 5_000): Promise<string | null> {
    return pollForLink(email, timeoutMs)
  }

  async visit(link: string) {
    await this.page.goto(link)
  }
}
