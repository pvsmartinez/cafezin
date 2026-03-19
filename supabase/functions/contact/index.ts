/**
 * Edge Function: contact (Cafezin landing)
 *
 * Public contact endpoint for cafezin.pmatz.com.
 * Receives form submissions from the landing page and forwards them to Pedro via Telegram.
 *
 * POST /contact
 *   body: { name, email?, message, locale?, pagePath?, company? }
 *
 * Required secrets:
 *   TELEGRAM_EMAIL_BOT_TOKEN
 *   TELEGRAM_PEDRO_CHAT_ID
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_EMAIL_BOT_TOKEN') ?? ''
const CHAT_ID = Deno.env.get('TELEGRAM_PEDRO_CHAT_ID') ?? ''

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

function sanitizeLine(value: string): string {
  return value.replace(/[<>]/g, '').trim()
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)

  let body: {
    name?: string
    email?: string
    message?: string
    locale?: string
    pagePath?: string
    company?: string
  }

  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400, origin)
  }

  if ((body.company ?? '').trim()) {
    return json({ ok: true }, 200, origin)
  }

  const name = sanitizeLine(body.name ?? '')
  const email = sanitizeLine(body.email ?? '')
  const message = (body.message ?? '').trim()
  const locale = sanitizeLine(body.locale ?? '') || 'unknown'
  const pagePath = sanitizeLine(body.pagePath ?? '') || '/contact'

  if (!name || !message) {
    return json({ error: 'name and message are required' }, 400, origin)
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('TELEGRAM_EMAIL_BOT_TOKEN or TELEGRAM_PEDRO_CHAT_ID not set')
    return json({ error: 'Telegram credentials not configured' }, 500, origin)
  }

  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  const text = [
    '☕ <b>Novo contato do site do Cafezin</b>',
    '',
    `<b>Nome:</b> ${name}`,
    `<b>E-mail:</b> ${email || 'não informado'}`,
    `<b>Idioma:</b> ${locale}`,
    `<b>Página:</b> ${pagePath}`,
    '',
    '<b>Mensagem:</b>',
    message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'),
    '',
    `<i>Recebido em ${now}</i>`,
  ].join('\n')

  const telegramRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })

  if (!telegramRes.ok) {
    console.error('Telegram API error:', await telegramRes.text())
    return json({ error: 'Failed to notify Telegram' }, 502, origin)
  }

  return json({ ok: true }, 200, origin)
})