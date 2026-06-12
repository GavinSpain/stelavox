/**
 * POST /api/admin/payments/config — write a single Stripe config key.
 *
 * Phase 9.B admin payments (C.5). Body: { key, value, valueConfirm? }.
 * Returns the write result (ok / error / old / new). Stored via
 * writeAdminPaymentConfig which runs the auth check, allowlist,
 * validation, audit_log, and cache invalidation inline.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { writeAdminPaymentConfig } from '@/lib/admin/payments/writes'

export async function POST(req: NextRequest): Promise<Response> {
  let body: { key?: unknown; value?: unknown; valueConfirm?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json(
      { ok: false, error: 'request body must be JSON' },
      { status: 400 },
    )
  }
  if (typeof body.key !== 'string' || typeof body.value !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'key + value: string required' },
      { status: 400 },
    )
  }

  const result = await writeAdminPaymentConfig({
    key: body.key,
    value: body.value,
    valueConfirm: typeof body.valueConfirm === 'string' ? body.valueConfirm : undefined,
  })

  if (!result.ok) {
    const status = result.error === 'unauthorized' ? 403 : 400
    return NextResponse.json(result, { status })
  }

  return NextResponse.json(result)
}
