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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-admin-secret, content-type',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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

// ─── GET /users ────────────────────────────────────────────────────────────────
async function listUsers(): Promise<Response> {
  const client = serviceClient()

  const { data: { users }, error: authErr } = await client.auth.admin.listUsers({ perPage: 1000 })
  if (authErr) return err(authErr.message, 500)

  const { data: subs, error: subErr } = await client
    .from('user_subscriptions')
    .select('user_id, plan, status, provider, provider_customer_id, provider_subscription_id, provider_price_id, current_period_end, cancel_at_period_end, trial_end, created_at, updated_at')

  if (subErr) return err(subErr.message, 500)

  const subsMap = new Map((subs ?? []).map((s) => [s.user_id, s]))

  const result = users.map((u) => ({
    id:            u.id,
    email:         u.email,
    created_at:    u.created_at,
    last_sign_in:  u.last_sign_in_at,
    confirmed:     !!u.confirmed_at,
    subscription:  subsMap.get(u.id) ?? null,
  }))

  return json({ users: result, total: result.length })
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
