/**
 * billing-webhook — Paddle webhook handler for Cafezin.
 *
 * Registers subscription events and keeps `user_subscriptions` in sync.
 * Uses billing_events for idempotent processing (UNIQUE provider + event_id).
 *
 * Webhook URL:
 *   https://dxxwlnvemqgpdrnkzrcr.supabase.co/functions/v1/billing-webhook
 *
 * Required secrets (supabase secrets set --project-ref dxxwlnvemqgpdrnkzrcr):
 *   PADDLE_WEBHOOK_SECRET  — from Paddle Dashboard → Notifications → webhook secret
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ── Signature verification ─────────────────────────────────────────────────

function buf2hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies a Paddle webhook signature.
 * Header format: `ts=<timestamp>;h1=<hmac-sha256>`
 * Signed payload: `<timestamp>:<rawBody>`
 */
async function verifySignature(body: string, signatureHeader: string): Promise<boolean> {
  const secret = Deno.env.get('PADDLE_WEBHOOK_SECRET');
  if (!secret) throw new Error('PADDLE_WEBHOOK_SECRET not set');

  // Parse ts and h1 from header
  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) parts[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
  }

  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signedPayload = `${ts}:${body}`;
  const expected = buf2hex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload)),
  );
  return expected === h1;
}

// ── Status mapping ─────────────────────────────────────────────────────────

function mapStatus(paddleStatus: string): string {
  switch (paddleStatus) {
    case 'active':    return 'active';
    case 'trialing':  return 'trialing';
    case 'past_due':  return 'past_due';
    case 'paused':    return 'past_due';
    case 'canceled':
    case 'cancelled': return 'canceled';
    default:          return 'inactive';
  }
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const signatureHeader = req.headers.get('Paddle-Signature') ?? '';

  let valid = false;
  try {
    valid = await verifySignature(body, signatureHeader);
  } catch (e) {
    console.error('Signature check error:', e);
  }

  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType: string           = event.event_type ?? '';
  const eventId: string             = event.event_id   ?? crypto.randomUUID();
  const data                        = event.data ?? {};
  const userId: string | undefined  = data.custom_data?.user_id;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Idempotency ──────────────────────────────────────────────────────────
  const { error: dupError } = await supabase
    .from('billing_events')
    .insert({
      provider:   'paddle',
      event_id:   eventId,
      event_type: eventType,
      user_id:    userId ?? null,
      payload:    event,
    });

  if (dupError?.code === '23505') {
    // Duplicate delivery — already processed, safe to ack
    return new Response('ok', { status: 200 });
  }
  if (dupError) {
    console.error('billing_events insert error:', dupError);
    return new Response('Internal error', { status: 500 });
  }

  // ── Subscription events ──────────────────────────────────────────────────
  if (userId && eventType.startsWith('subscription.')) {
    const paddleStatus: string = data.status ?? '';
    const status = mapStatus(paddleStatus);
    const plan   = (status === 'canceled' || status === 'inactive') ? 'free' : 'premium';

    // cancel_at_period_end: true when a cancellation is scheduled but not yet effective
    const cancelAtPeriodEnd = data.scheduled_change?.action === 'cancel';
    const priceId           = data.items?.[0]?.price?.id ?? null;

    const { error: upsertErr } = await supabase
      .from('user_subscriptions')
      .upsert(
        {
          user_id:                  userId,
          plan,
          status,
          provider:                 'paddle',
          provider_customer_id:     String(data.customer_id ?? ''),
          provider_subscription_id: String(data.id ?? ''),
          provider_price_id:        String(priceId ?? ''),
          current_period_start:     data.current_billing_period?.starts_at ?? null,
          current_period_end:       data.current_billing_period?.ends_at   ?? null,
          cancel_at_period_end:     cancelAtPeriodEnd,
          trial_end:                data.trial_dates?.ends_at ?? null,
          updated_at:               new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (upsertErr) {
      console.error('user_subscriptions upsert error:', upsertErr);
      // Still return 200 so Paddle doesn't retry — event is already stored in billing_events
    }
  }

  return new Response('ok', { status: 200 });
});
