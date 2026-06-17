/**
 * /terms — Terms of Service stub (Phase 13.1).
 *
 * PLACEHOLDER COPY — flagged for legal review before launch.
 */

import type { Metadata } from 'next'

import { LegalH2, LegalPage } from '@/components/marketing/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service — Stelavox',
  description: 'The terms that govern your use of Stelavox.',
  robots: { index: true, follow: true },
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="14 June 2026">
      <p>
        <strong style={{ color: 'var(--color-text-primary)' }}>This is a placeholder pending legal review.</strong>{' '}
        It outlines the intended terms; the final agreement will be reviewed by counsel before launch.
      </p>

      <LegalH2>Your account</LegalH2>
      <p>
        You are responsible for keeping your account credentials secure and for the activity under
        your account. Stelavox is for lawful writing use only.
      </p>

      <LegalH2>Your content</LegalH2>
      <p>
        You retain full ownership of everything you write. We claim no rights over your manuscripts.
        We provide the tools to create, structure, and export your work; the work is yours.
      </p>

      <LegalH2>AI assistance</LegalH2>
      <p>
        The Director and agents act only on the instructions and plans you approve. AI-generated
        suggestions are provided as-is; you decide what to accept into your manuscript.
      </p>

      <LegalH2>Plans and billing</LegalH2>
      <p>
        Paid plans are billed through Stripe per the plan you choose. A free trial is available.
        You can manage or cancel your subscription at any time; cancellation stops future billing
        and preserves your data per the Privacy Policy.
      </p>

      <LegalH2>Availability</LegalH2>
      <p>
        We aim for high availability but do not guarantee uninterrupted service. We may update these
        terms; material changes will be communicated to account holders.
      </p>

      <LegalH2>Contact</LegalH2>
      <p>
        Questions about these terms:{' '}
        <a href="mailto:hello@stelavox.com" style={{ color: 'var(--color-accent-hover)' }}>
          hello@stelavox.com
        </a>
        .
      </p>
    </LegalPage>
  )
}
