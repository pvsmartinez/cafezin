interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri: string
}

const GA4_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-admin-secret, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

let cachedGa4Token: { value: string; exp: number } | null = null

const json = (data: unknown, status = 200, headers?: HeadersInit): Response => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function b64url(input: string): string
function b64url(input: Uint8Array): string
function b64url(input: string | Uint8Array): string {
  if (typeof input === 'string') {
    return btoa(input).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  }

  let binary = ''
  for (let index = 0; index < input.length; index += 1) {
    binary += String.fromCharCode(input[index])
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getGa4AccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  if (cachedGa4Token && cachedGa4Token.exp > now + 60) return cachedGa4Token.value

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: serviceAccount.token_uri,
    iat: now,
    exp: now + 3540,
  }))

  const signingInput = `${header}.${payload}`
  const pemKey = serviceAccount.private_key.replace(/\\n/g, '\n')
  const b64Key = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const keyBytes = Uint8Array.from(atob(b64Key), (char) => char.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  )

  const jwt = `${signingInput}.${b64url(new Uint8Array(signature))}`
  const tokenResponse = await fetch(serviceAccount.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  const tokenData = await tokenResponse.json() as { access_token?: string; expires_in?: number }
  if (!tokenData.access_token) {
    throw new Error(`Google OAuth2 falhou: ${JSON.stringify(tokenData)}`)
  }

  cachedGa4Token = {
    value: tokenData.access_token,
    exp: now + (tokenData.expires_in ?? 3600),
  }

  return tokenData.access_token
}

async function fetchStandardGa4Data(token: string, propertyId: string) {
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
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
          {
            dimensions: [{ name: 'pagePath' }],
            metrics: [{ name: 'screenPageViews' }],
            dateRanges: [{ startDate: '30daysAgo', endDate: 'yesterday' }],
            orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
            limit: 10,
          },
        ],
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`GA4 Data API ${response.status}: ${await response.text()}`)
  }

  const data = await response.json() as {
    reports: Array<{
      rows?: Array<{
        dimensionValues?: Array<{ value: string }>
        metricValues: Array<{ value: string }>
      }>
    }>
  }

  const [aggregateReport, pagesReport] = data.reports
  const aggregateRow = aggregateReport?.rows?.[0]

  return {
    sessions_7d: aggregateRow ? Number(aggregateRow.metricValues[0].value) : 0,
    users_7d: aggregateRow ? Number(aggregateRow.metricValues[1].value) : 0,
    bounce_rate_7d: aggregateRow ? Math.round(Number(aggregateRow.metricValues[2].value) * 100) : 0,
    page_views_7d: aggregateRow ? Number(aggregateRow.metricValues[3].value) : 0,
    avg_session_duration_7d: aggregateRow ? Math.round(Number(aggregateRow.metricValues[4].value)) : 0,
    top_pages_30d: (pagesReport?.rows ?? []).map((row) => ({
      path: row.dimensionValues?.[0].value ?? '/',
      views: Number(row.metricValues[0].value),
    })),
  }
}

export const serveStandardGa4Analytics = () => {
  const adminSecret = Deno.env.get('ADMIN_SECRET')!
  const serviceAccountJson = Deno.env.get('GA4_SERVICE_ACCOUNT_KEY') ?? ''
  const propertyId = Deno.env.get('GA4_PROPERTY_ID') ?? ''

  Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: GA4_CORS })

    const secret = req.headers.get('x-admin-secret')
    if (!secret || secret !== adminSecret) return json({ error: 'Forbidden' }, 403, GA4_CORS)

    if (!serviceAccountJson || !propertyId) {
      return json({ error: 'GA4_SERVICE_ACCOUNT_KEY ou GA4_PROPERTY_ID não configurados' }, 503, GA4_CORS)
    }

    let serviceAccount: ServiceAccount
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount
    } catch {
      return json({ error: 'GA4_SERVICE_ACCOUNT_KEY inválido (JSON malformado)' }, 500, GA4_CORS)
    }

    try {
      const token = await getGa4AccessToken(serviceAccount)
      const analytics = await fetchStandardGa4Data(token, propertyId)
      return json(analytics, 200, GA4_CORS)
    } catch (error) {
      console.error('ga4-analytics error:', error)
      return json({ error: (error as Error).message }, 500, GA4_CORS)
    }
  })
}