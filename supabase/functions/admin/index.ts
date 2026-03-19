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

interface LandingEventRow {
  created_at: string
  event_name: string
  page_path: string
  platform: string | null
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

async function listAnalytics(): Promise<{
  since_7d: string
  since_30d: string
  page_views_7d: number
  page_views_30d: number
  download_clicks_7d: number
  premium_checkout_starts_7d: number
  premium_checkout_successes_30d: number
  contact_submits_30d: number
  downloads_by_platform_30d: Record<string, number>
  top_pages_30d: Array<{ path: string; views: number }>
}> {
  const now = Date.now()
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000)

  const { data, error } = await serviceClient()
    .from('landing_events')
    .select('created_at, event_name, page_path, platform')
    .gte('created_at', since30d.toISOString())
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as LandingEventRow[]
  const pageCounts = new Map<string, number>()
  const downloadsByPlatform = { mac: 0, windows: 0, ios: 0, android: 0, other: 0 }

  let pageViews7d = 0
  let pageViews30d = 0
  let downloads7d = 0
  let checkoutStarts7d = 0
  let checkoutSuccess30d = 0
  let contactSubmits30d = 0

  for (const row of rows) {
    const createdAt = new Date(row.created_at).getTime()
    const in7d = createdAt >= since7d.getTime()

    if (row.event_name === 'page_view') {
      pageViews30d += 1
      if (in7d) pageViews7d += 1
      pageCounts.set(row.page_path, (pageCounts.get(row.page_path) ?? 0) + 1)
    }

    if (row.event_name === 'download_click') {
      if (in7d) downloads7d += 1
      const platform = (row.platform ?? 'other') as keyof typeof downloadsByPlatform
      if (platform in downloadsByPlatform) downloadsByPlatform[platform] += 1
      else downloadsByPlatform.other += 1
    }

    if (row.event_name === 'premium_checkout_start' && in7d) checkoutStarts7d += 1
    if (row.event_name === 'premium_checkout_success') checkoutSuccess30d += 1
    if (row.event_name === 'contact_submit') contactSubmits30d += 1
  }

  const topPages = Array.from(pageCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([path, views]) => ({ path, views }))

  return {
    since_7d: since7d.toISOString(),
    since_30d: since30d.toISOString(),
    page_views_7d: pageViews7d,
    page_views_30d: pageViews30d,
    download_clicks_7d: downloads7d,
    premium_checkout_starts_7d: checkoutStarts7d,
    premium_checkout_successes_30d: checkoutSuccess30d,
    contact_submits_30d: contactSubmits30d,
    downloads_by_platform_30d: downloadsByPlatform,
    top_pages_30d: topPages,
  }
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
  const analytics = await listAnalytics().catch((error) => {
    console.error('Failed to load landing analytics:', error)
    return null
  })

  return json({ users: result, total: result.length, mrr_centavos: mrrCentavos, analytics })
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
