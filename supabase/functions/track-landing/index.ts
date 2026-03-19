/**
 * Edge Function: track-landing (Cafezin landing)
 *
 * Public analytics intake used by the static landing pages.
 * Stores lightweight funnel events in Supabase while Vercel Analytics handles page/bounce basics.
 *
 * POST /track-landing
 *   body: { eventName, pagePath, locale?, platform?, referrer?, metadata? }
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const ALLOWED_EVENTS = new Set([
  'page_view',
  'download_click',
  'premium_checkout_start',
  'premium_checkout_success',
  'contact_submit',
])

function allowedOrigin(origin: string | null): string {
  if (!origin) return 'https://cafezin.pmatz.com'
  if (
    origin === 'https://cafezin.pmatz.com'
    || origin === 'https://www.cafezin.pmatz.com'
    || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  ) {
    return origin
  }
  return 'https://cafezin.pmatz.com'
}

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(origin),
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  })
}

function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function sanitizeMetadata(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const entries = Object.entries(value as Record<string, unknown>).slice(0, 12)
  const result: Record<string, string | number | boolean | null> = {}

  for (const [key, raw] of entries) {
    const cleanKey = key.trim().slice(0, 64)
    if (!cleanKey) continue
    if (typeof raw === 'string') result[cleanKey] = raw.slice(0, 255)
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[cleanKey] = raw
    else if (typeof raw === 'boolean' || raw === null) result[cleanKey] = raw
  }

  return result
}

function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)

  let body: Record<string, unknown>

  try {
    body = JSON.parse(await req.text())
  } catch {
    return json({ error: 'Invalid JSON' }, 400, origin)
  }

  const eventName = sanitizeText(body.eventName, 80)
  const pagePath = sanitizeText(body.pagePath, 200)
  const locale = sanitizeText(body.locale, 16)
  const platform = sanitizeText(body.platform, 32)
  const referrer = sanitizeText(body.referrer, 200)
  const metadata = sanitizeMetadata(body.metadata)

  if (!eventName || !pagePath || !ALLOWED_EVENTS.has(eventName)) {
    return json({ error: 'Invalid event payload' }, 400, origin)
  }

  const { error } = await serviceClient()
    .from('landing_events')
    .insert({
      event_name: eventName,
      page_path: pagePath,
      locale,
      platform,
      referrer,
      metadata,
    })

  if (error) {
    console.error('Failed to insert landing event:', error)
    return json({ error: 'Failed to store event' }, 500, origin)
  }

  return json({ ok: true }, 200, origin)
})