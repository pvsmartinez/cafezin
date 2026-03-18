/**
 * create-checkout — Creates a Lemon Squeezy checkout session for the calling user.
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
 *   LEMONSQUEEZY_API_KEY     — from LS Dashboard → API Keys
 *   LEMONSQUEEZY_STORE_ID    — numeric store ID from LS Dashboard URL
 *   LEMONSQUEEZY_VARIANT_ID  — numeric variant ID of the $10/month product
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

  // ── Create Lemon Squeezy checkout ─────────────────────────────────────────
  const apiKey    = Deno.env.get('LEMONSQUEEZY_API_KEY')!;
  const storeId   = Deno.env.get('LEMONSQUEEZY_STORE_ID')!;
  const variantId = Deno.env.get('LEMONSQUEEZY_VARIANT_ID')!;

  const lsRes = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${apiKey}`,
      'Content-Type':   'application/vnd.api+json',
      'Accept':         'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email:  user.email,
            // Passed back verbatim in every webhook event as meta.custom_data
            custom: { user_id: user.id },
          },
          product_options: {
            redirect_url:          'https://cafezin.app/premium/obrigado',
            receipt_button_text:   'Abrir Cafezin',
            receipt_thank_you_note:
              'Obrigado por assinar o Cafezin Premium! Abra o app e vá em Configurações → Conta → Atualizar status.',
          },
          preview: false,
        },
        relationships: {
          store:   { data: { type: 'stores',   id: storeId   } },
          variant: { data: { type: 'variants', id: variantId } },
        },
      },
    }),
  });

  if (!lsRes.ok) {
    const errText = await lsRes.text();
    console.error('Lemon Squeezy checkout error:', errText);
    return new Response(JSON.stringify({ error: 'Failed to create checkout' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const lsData = await lsRes.json();
  const url: string = lsData.data?.attributes?.url ?? '';

  return new Response(JSON.stringify({ url }), {
    status:  200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
