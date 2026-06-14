/**
 * /privacy — Privacy Policy stub (Phase 13.1).
 *
 * PLACEHOLDER COPY — flagged for legal review before launch. Covers the three
 * data uses the spec requires: account data, the waitlist email, and Stripe.
 */

import type { Metadata } from 'next'

import { LegalH2, LegalPage } from '@/components/marketing/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy — Stelavox',
  description: 'How Stelavox handles your account data, waitlist email, and payment information.',
  robots: { index: true, follow: true },
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="14 June 2026">
      <p>
        <strong style={{ color: 'var(--color-text-primary)' }}>This is a placeholder pending legal review.</strong>{' '}
        It describes our intended practices; the final policy will be reviewed by counsel before launch.
      </p>

      <LegalH2>Your writing and account data</LegalH2>
      <p>
        The documents, structure, and prose you create are private to your account and encrypted at
        rest. We do not read, sell, or use your manuscript content to train models. You can export
        your work at any time in standard formats and delete your account.
      </p>

      <LegalH2>Waitlist email</LegalH2>
      <p>
        If you join the pre-launch waitlist, we store the email address you provide solely to notify
        you when Stelavox opens. We will not share it or send marketing beyond launch-related notices.
        Ask us to remove you at any time at{' '}
        <a href="mailto:hello@stelavox.com" style={{ color: 'var(--color-accent-hover)' }}>
          hello@stelavox.com
        </a>
        .
      </p>

      <LegalH2>Payments</LegalH2>
      <p>
        Subscriptions are processed by Stripe. We do not store your card details; Stripe handles
        payment data under its own privacy terms. We retain only the subscription status and plan
        needed to operate your account.
      </p>

      <LegalH2>AI processing</LegalH2>
      <p>
        When you ask the Director or an agent to assist, the relevant content is sent to our AI
        provider (Anthropic) to generate the response you requested, and only then. If you bring your
        own API key, requests are routed through your provider account.
      </p>

      <LegalH2>Contact</LegalH2>
      <p>
        Questions about privacy:{' '}
        <a href="mailto:hello@stelavox.com" style={{ color: 'var(--color-accent-hover)' }}>
          hello@stelavox.com
        </a>
        .
      </p>
    </LegalPage>
  )
}
