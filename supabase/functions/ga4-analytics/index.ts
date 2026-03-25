/**
 * Edge Function: ga4-analytics (Cafezin)
 *
 * Proxy para a GA4 Data API v1beta.
 * Autenticado com Service Account armazenado como secret.
 * Usado apenas pelo admin.pmatz.com.
 *
 * GET /ga4-analytics
 *   Header: x-admin-secret: <ADMIN_SECRET>
 *
 * Secrets necessários:
 *   ADMIN_SECRET               — mesma senha do admin
 *   GA4_SERVICE_ACCOUNT_KEY    — JSON completo da Service Account do Google Cloud
 *   GA4_PROPERTY_ID            — ID numérico da propriedade GA4 (ex: "123456789")
 */

const ADMIN_SECRET    = Deno.env.get('ADMIN_SECRET')!
const SA_KEY_JSON     = Deno.env.get('GA4_SERVICE_ACCOUNT_KEY') ?? ''
const GA4_PROPERTY_ID = Deno.env.get('GA4_PROPERTY_ID') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-admin-secret, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri: string
}

// Cache de access token em memória (válido por instância quente).
let cachedToken: { value: string; exp: number } | null = null

function b64url(input: string): string
function b64url(input: Uint8Array): string
function b64url(input: string | Uint8Array): string {
  if (typeof input === 'string') {
    return btoa(input).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  }
  let binary = ''
  for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i])
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.value

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud:   sa.token_uri,
    iat:   now,
    exp:   now + 3540,
  }))

  const signingInput = `${header}.${payload}`

  const pemKey  = sa.private_key.replace(/\\n/g, '\n')
  const b64Key  = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const keyBytes = Uint8Array.from(atob(b64Key), (c) => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  )

  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`

  const tokenRes = await fetch(sa.token_uri, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  const tokenData = await tokenRes.json() as { access_token?: string; expires_in?: number }
  if (!tokenData.access_token) {
    throw new Error(`Google OAuth2 falhou: ${JSON.stringify(tokenData)}`)
  }

  cachedToken = {
    value: tokenData.access_token,
    exp:   now + (tokenData.expires_in ?? 3600),
  }

  return tokenData.access_token
}

async function fetchGA4Data(token: string, propertyId: string) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`

  const body = {
    requests: [
      // Relatório 1: métricas agregadas dos últimos 7 dias
      {
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'bounceRate' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
        ],
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      },
      // Relatório 2: top páginas dos últimos 30 dias
      {
        dimensions: [{ name: 'pagePath' }],
        metrics:    [{ name: 'screenPageViews' }],
        dateRanges: [{ startDate: '30daysAgo', endDate: 'yesterday' }],
        orderBys:   [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit:      10,
      },
    ],
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GA4 Data API ${res.status}: ${err}`)
  }

  const data = await res.json() as {
    reports: Array<{
      rows?: Array<{
        dimensionValues?: Array<{ value: string }>
        metricValues:     Array<{ value: string }>
      }>
    }>
  }

  const [aggReport, pagesReport] = data.reports

  // Relatório agregado (linha única ou vazia)
  const aggRow = aggReport?.rows?.[0]
  const sessions         = aggRow ? Number(aggRow.metricValues[0].value) : 0
  const users            = aggRow ? Number(aggRow.metricValues[1].value) : 0
  const bounceRate       = aggRow ? Number(aggRow.metricValues[2].value) : 0 // 0-1
  const pageViews        = aggRow ? Number(aggRow.metricValues[3].value) : 0
  const avgSessionSecs   = aggRow ? Number(aggRow.metricValues[4].value) : 0

  // Top páginas
  const topPages = (pagesReport?.rows ?? []).map((row) => ({
    path:  row.dimensionValues?.[0].value ?? '/',
    views: Number(row.metricValues[0].value),
  }))

  return {
    sessions_7d:              sessions,
    users_7d:                 users,
    bounce_rate_7d:           Math.round(bounceRate * 100), // converte para %
    page_views_7d:            pageViews,
    avg_session_duration_7d:  Math.round(avgSessionSecs),
    top_pages_30d:            topPages,
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const secret = req.headers.get('x-admin-secret')
  if (!secret || secret !== ADMIN_SECRET) return json({ error: 'Forbidden' }, 403)

  if (!SA_KEY_JSON || !GA4_PROPERTY_ID) {
    return json({ error: 'GA4_SERVICE_ACCOUNT_KEY ou GA4_PROPERTY_ID não configurados' }, 503)
  }

  let sa: ServiceAccount
  try {
    sa = JSON.parse(SA_KEY_JSON) as ServiceAccount
  } catch {
    return json({ error: 'GA4_SERVICE_ACCOUNT_KEY inválido (JSON malformado)' }, 500)
  }

  try {
    const token = await getAccessToken(sa)
    const ga4   = await fetchGA4Data(token, GA4_PROPERTY_ID)
    return json(ga4)
  } catch (e) {
    console.error('ga4-analytics error:', e)
    return json({ error: (e as Error).message }, 500)
  }
})
