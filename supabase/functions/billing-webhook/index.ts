/**
 * billing-webhook — Lemon Squeezy webhook handler for Cafezin.
 *
 * Registers subscription events and keeps `user_subscriptions` in sync.
 * Uses billing_events for idempotent processing (UNIQUE provider + event_id).
 *
 * Webhook URL:
 *   https://dxxwlnvemqgpdrnkzrcr.supabase.co/functions/v1/billing-webhook
 *
 * Required secrets (supabase secrets set --project-ref dxxwlnvemqgpdrnkzrcr):
 *   LEMONSQUEEZY_SIGNING_SECRET  — from LS Dashboard → Settings → Webhooks
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ── Signature verification ─────────────────────────────────────────────────

function buf2hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifySignature(body: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get('LEMONSQUEEZY_SIGNING_SECRET');
  if (!secret) throw new Error('LEMONSQUEEZY_SIGNING_SECRET not set');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = buf2hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return expected === signature;
}

// ── Status mapping ─────────────────────────────────────────────────────────

function mapStatus(lsStatus: string): string {
  switch (lsStatus) {
    case 'active':    return 'active';
    case 'trialing':  return 'trialing';
    case 'past_due':  return 'past_due';
    case 'cancelled':
    case 'canceled':  return 'canceled';
    case 'expired':   return 'inactive';
    case 'paused':    return 'past_due';
    default:          return lsStatus;
  }
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const signature = req.headers.get('X-Signature') ?? '';

  let valid = false;
  try {
    valid = await verifySignature(body, signature);
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

  const eventType: string  = event.meta?.event_name ?? '';
  const eventId: string    = event.meta?.webhook_id ?? crypto.randomUUID();
  const customData         = event.meta?.custom_data ?? {};
  const userId: string | undefined = customData.user_id;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Idempotency ──────────────────────────────────────────────────────────
  const { error: dupError } = await supabase
    .from('billing_events')
    .insert({
      provider:   'lemonsqueezy',
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
  if (userId && eventType.startsWith('subscription_')) {
    const attrs              = event.data?.attributes ?? {};
    const lsStatus: string   = attrs.status ?? '';
    const status             = eventType === 'subscription_expired'
      ? 'inactive'
      : mapStatus(lsStatus);
    const plan               = (status === 'canceled' || status === 'inactive') ? 'free' : 'premium';

    const { error: upsertErr } = await supabase
      .from('user_subscriptions')
      .upsert(
        {
          user_id:                  userId,
          plan,
          status,
          provider:                 'lemonsqueezy',
          provider_customer_id:     String(attrs.customer_id ?? ''),
          provider_subscription_id: String(event.data?.id ?? ''),
          provider_price_id:        String(attrs.variant_id ?? ''),
          current_period_start:     attrs.current_period_start ?? null,
          current_period_end:       attrs.current_period_end   ?? null,
          cancel_at_period_end:     attrs.cancel_at_period_end ?? false,
          trial_end:                attrs.trial_ends_at        ?? null,
          updated_at:               new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (upsertErr) {
      console.error('user_subscriptions upsert error:', upsertErr);
      // Still return 200 so LS doesn't retry — event is already stored in billing_events
    }
  }

  return new Response('ok', { status: 200 });
});
