/**
 * create-checkout — Creates a Paddle checkout session for the calling user.
 *
 * The checkout is pre-filled with the user's email and includes their Supabase
 * user_id as custom_data so the billing-webhook can link the subscription back.
 *
 * POST /functions/v1/create-checkout
 * Authorization: Bearer <supabase-access-token>
 *
 * Response: { url: string }   — open this URL in the user's browser
 *
 * Required secrets:
 *   PADDLE_API_KEY        — from Paddle Dashboard → Developer → Authentication
 *   PADDLE_PRICE_ID       — subscription price ID (format: pri_...)
 *   PADDLE_ENVIRONMENT    — 'sandbox' or 'production'
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  // ── Auth: get calling user from JWT ──────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase   = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );

  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Create Paddle checkout ────────────────────────────────────────────────
  const apiKey  = Deno.env.get('PADDLE_API_KEY')!;
  const priceId = Deno.env.get('PADDLE_PRICE_ID')!;
  const env     = Deno.env.get('PADDLE_ENVIRONMENT') ?? 'production';
  const baseUrl = env === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';

  const paddleRes = await fetch(`${baseUrl}/transactions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      customer_email: user.email,
      // Passed back verbatim in every webhook event as data.custom_data
      custom_data: { user_id: user.id },
      checkout: {
        url: 'https://cafezin.app/premium/obrigado',
      },
    }),
  });

  if (!paddleRes.ok) {
    const errText = await paddleRes.text();
    console.error('Paddle checkout error:', errText);
    return new Response(JSON.stringify({ error: 'Failed to create checkout' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const paddleData = await paddleRes.json();
  const url: string = paddleData.data?.checkout?.url ?? '';

  return new Response(JSON.stringify({ url }), {
    status:  200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
