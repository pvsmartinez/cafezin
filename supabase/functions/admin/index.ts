/**
 * Edge Function: admin (Cafezin)
 *
 * Painel administrativo centralizado — acesso restrito via ADMIN_SECRET.
 * Nunca exposta ao usuário final; usada apenas pelo admin.pmatz.com.
 *
 * Rotas:
 *   GET  /users                      → lista auth.users + user_subscriptions
 *   PATCH /users/:id/subscription    → override manual de plano
 *
 * Autenticação:
 *   Header: x-admin-secret: <ADMIN_SECRET>
 *
 * Secrets necessários (supabase secrets set --project-ref dxxwlnvemqgpdrnkzrcr):
 *   ADMIN_SECRET  — senha mestra do painel admin
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_SECRET              = Deno.env.get('ADMIN_SECRET')!
const PADDLE_API_KEY            = Deno.env.get('PADDLE_API_KEY') ?? ''
const PADDLE_PRICE_ID           = Deno.env.get('PADDLE_PRICE_ID') ?? ''
const PADDLE_ENVIRONMENT        = Deno.env.get('PADDLE_ENVIRONMENT') ?? 'production'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-admin-secret, content-type',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
}

interface SubscriptionRow {
  user_id: string
  plan: string | null
  status: string | null
  provider: string | null
  provider_customer_id: string | null
  provider_subscription_id: string | null
  provider_price_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
  trial_end: string | null
  created_at: string
  updated_at: string
}

interface AuthUserRow {
  id: string
  email?: string
  created_at: string
  last_sign_in_at: string | null
  confirmed_at?: string | null
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status)
}

function assertAdmin(req: Request): true | Response {
  const secret = req.headers.get('x-admin-secret')
  if (!secret || secret !== ADMIN_SECRET) return err('Forbidden', 403)
  return true
}

function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function getPaddleBaseUrl() {
  return PADDLE_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com'
}

function extractMinorUnits(preview: any): number | null {
  const data = preview?.data ?? {}
  const item = data?.items?.[0] ?? {}
  const detailLineItem = data?.details?.line_items?.[0] ?? {}
  const candidates = [
    detailLineItem?.totals?.total,
    item?.totals?.total,
    data?.details?.totals?.total,
  ]

  for (const value of candidates) {
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }

  return null
}

async function fetchPaddlePriceMinorUnits(priceId: string): Promise<number | null> {
  if (!PADDLE_API_KEY || !priceId) return null

  const paddleRes = await fetch(`${getPaddleBaseUrl()}/pricing-preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      currency_code: 'BRL',
    }),
  })

  if (!paddleRes.ok) {
    console.error(`Paddle pricing preview failed for ${priceId}:`, await paddleRes.text())
    return null
  }

  return extractMinorUnits(await paddleRes.json())
}

async function estimateMrrCentavos(
  subs: Array<{
    plan: string | null
    status: string | null
    provider: string | null
    provider_price_id: string | null
  }>,
): Promise<number | null> {
  const activeCounts = new Map<string, number>()

  for (const sub of subs) {
    if (sub.plan !== 'premium' || sub.status !== 'active' || sub.provider !== 'paddle') continue

    const priceId = sub.provider_price_id || PADDLE_PRICE_ID
    if (!priceId) continue

    activeCounts.set(priceId, (activeCounts.get(priceId) ?? 0) + 1)
  }

  if (activeCounts.size === 0) return 0

  let total = 0
  for (const [priceId, count] of activeCounts.entries()) {
    const unitAmount = await fetchPaddlePriceMinorUnits(priceId)
    if (unitAmount == null) return null
    total += unitAmount * count
  }

  return total
}

// ─── GET /users ────────────────────────────────────────────────────────────────
async function listUsers(): Promise<Response> {
  const client = serviceClient()

  const { data: { users }, error: authErr } = await client.auth.admin.listUsers({ perPage: 1000 })
  if (authErr) return err(authErr.message, 500)

  const { data: subs, error: subErr } = await client
    .from('user_subscriptions')
    .select('user_id, plan, status, provider, provider_customer_id, provider_subscription_id, provider_price_id, current_period_end, cancel_at_period_end, trial_end, created_at, updated_at')

  if (subErr) return err(subErr.message, 500)

  const typedSubs = (subs ?? []) as SubscriptionRow[]
  const typedUsers = users as AuthUserRow[]
  const subsMap = new Map(typedSubs.map((sub) => [sub.user_id, sub]))

  const result = typedUsers.map((u) => ({
    id:            u.id,
    email:         u.email,
    created_at:    u.created_at,
    last_sign_in:  u.last_sign_in_at,
    confirmed:     !!u.confirmed_at,
    subscription:  subsMap.get(u.id) ?? null,
  }))

  const mrrCentavos = await estimateMrrCentavos(typedSubs)

  return json({ users: result, total: result.length, mrr_centavos: mrrCentavos })
}

// ─── PATCH /users/:id/subscription ────────────────────────────────────────────
async function updateSubscription(userId: string, body: Record<string, unknown>): Promise<Response> {
  const allowed = ['plan', 'status', 'provider', 'current_period_end', 'cancel_at_period_end', 'trial_end']
  const payload: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() }

  for (const key of allowed) {
    if (key in body) payload[key] = body[key]
  }

  if (!payload.plan)   payload.plan   = 'premium'
  if (!payload.status) payload.status = 'active'
  if (!payload.provider && !('provider' in body)) payload.provider = 'manual'

  const { data, error } = await serviceClient()
    .from('user_subscriptions')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return err(error.message, 500)
  return json(data)
}

// ─── Router ────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const guard = assertAdmin(req)
  if (guard !== true) return guard

  const url      = new URL(req.url)
  const segments = url.pathname.replace(/^\/+admin\/*/i, '').split('/').filter(Boolean)
  // Also handle when Supabase strips the function name:  /users/:id/subscription
  const path     = '/' + segments.join('/')

  // GET /users
  if (req.method === 'GET' && (path === '/users' || path === '/')) {
    return listUsers()
  }

  // PATCH /users/:id/subscription
  if (req.method === 'PATCH' && segments[0] === 'users' && segments[2] === 'subscription') {
    const userId = segments[1]
    if (!userId) return err('Missing user id')
    const body = await req.json().catch(() => ({}))
    return updateSubscription(userId, body)
  }

  return err('Not found', 404)
})
