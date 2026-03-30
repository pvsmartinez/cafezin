/**
 * create-customer-portal — Creates a Paddle customer portal session URL for
 * the calling user.
 *
 * POST /functions/v1/create-customer-portal
 * Authorization: Bearer <supabase-access-token>
 *
 * Response: { url: string }
 *
 * Required secrets:
 *   PADDLE_API_KEY     — from Paddle Dashboard → Developer → Authentication
 *   PADDLE_ENVIRONMENT — 'sandbox' or 'production'
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { data: subscription, error: subErr } = await supabase
    .from('user_subscriptions')
    .select('provider, provider_customer_id, provider_subscription_id, plan')
    .eq('user_id', user.id)
    .maybeSingle();

  if (subErr) {
    console.error('Failed to load subscription:', subErr);
    return new Response(JSON.stringify({ error: 'Failed to load subscription' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const paidPlans = new Set(['premium', 'basic', 'standard', 'pro']);

  if (!subscription || !paidPlans.has(subscription.plan)) {
    return new Response(JSON.stringify({ error: 'Paid subscription not found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (subscription.provider !== 'paddle' || !subscription.provider_customer_id) {
    return new Response(JSON.stringify({ error: 'Paddle customer not linked' }), {
      status: 409,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('PADDLE_API_KEY')!;
  const env = Deno.env.get('PADDLE_ENVIRONMENT') ?? 'production';
  const baseUrl = env === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';

  const body: Record<string, unknown> = {};
  if (subscription.provider_subscription_id) {
    body.subscription_ids = [subscription.provider_subscription_id];
  }

  const paddleRes = await fetch(
    `${baseUrl}/customers/${subscription.provider_customer_id}/portal-sessions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!paddleRes.ok) {
    const errText = await paddleRes.text();
    console.error('Paddle customer portal error:', errText);
    return new Response(JSON.stringify({ error: 'Failed to create customer portal session' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const paddleData = await paddleRes.json();
  const portalUrl: string = paddleData.data?.urls?.general?.overview ?? '';

  if (!portalUrl) {
    return new Response(JSON.stringify({ error: 'No customer portal URL returned' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ url: portalUrl }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});