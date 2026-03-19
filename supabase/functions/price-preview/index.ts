/**
 * price-preview — Public Paddle pricing preview for Cafezin landing pages.
 *
 * GET /functions/v1/price-preview?country=BR&currency=BRL
 *
 * Uses Paddle's pricing preview API to return a localized, formatted amount
 * for the single Cafezin Premium subscription price.
 *
 * Required secrets:
 *   PADDLE_API_KEY      — from Paddle Dashboard → Developer → Authentication
 *   PADDLE_PRICE_ID     — subscription price ID (format: pri_...)
 *   PADDLE_ENVIRONMENT  — 'sandbox' or 'production'
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=300',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function parseCountry(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function parseCurrency(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
  const firstIp = forwarded.split(',')[0]?.trim();
  return firstIp || null;
}

function formatMinorUnits(amount: string | null | undefined, currencyCode: string): string | null {
  if (!amount || !/^\d+$/.test(amount)) return null;
  const integerAmount = Number(amount);
  if (!Number.isFinite(integerAmount)) return null;

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode,
  }).format(integerAmount / 100);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const apiKey = Deno.env.get('PADDLE_API_KEY');
  const priceId = Deno.env.get('PADDLE_PRICE_ID');
  const environment = Deno.env.get('PADDLE_ENVIRONMENT') ?? 'production';

  if (!apiKey || !priceId) {
    return json({ error: 'Paddle pricing preview is not configured' }, 500);
  }

  const baseUrl = environment === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';

  const url = new URL(req.url);
  const countryCode = parseCountry(url.searchParams.get('country'));
  const currencyCode = parseCurrency(url.searchParams.get('currency'));
  const clientIp = getClientIp(req);

  const paddleBody: Record<string, unknown> = {
    items: [{ price_id: priceId, quantity: 1 }],
  };

  if (countryCode) {
    paddleBody.address = {
      country_code: countryCode,
      postal_code: null,
    };
  } else if (clientIp) {
    paddleBody.customer_ip_address = clientIp;
  }

  if (currencyCode) {
    paddleBody.currency_code = currencyCode;
  }

  const paddleRes = await fetch(`${baseUrl}/pricing-preview`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(paddleBody),
  });

  if (!paddleRes.ok) {
    const errorText = await paddleRes.text();
    console.error('Paddle price preview error:', errorText);
    return json({ error: 'Failed to preview Paddle price' }, 502);
  }

  const paddleData = await paddleRes.json();
  const data = paddleData?.data ?? {};
  const item = data?.items?.[0] ?? {};
  const detailLineItem = data?.details?.line_items?.[0] ?? {};
  const resolvedCurrency = data?.currency_code ?? currencyCode ?? 'BRL';
  const amountFormatted = detailLineItem?.formatted_totals?.total
    ?? detailLineItem?.formatted_unit_totals?.total
    ?? item?.formatted_totals?.total
    ?? item?.formatted_unit_totals?.total
    ?? formatMinorUnits(detailLineItem?.totals?.total, resolvedCurrency)
    ?? formatMinorUnits(item?.totals?.total, resolvedCurrency)
    ?? formatMinorUnits(data?.details?.totals?.total, resolvedCurrency);

  if (!amountFormatted) {
    return json({ error: 'Paddle preview did not return a formatted amount' }, 502);
  }

  return json({
    amountFormatted,
    currencyCode: resolvedCurrency,
    countryCode: data?.address?.country_code ?? countryCode,
    availablePaymentMethods: data?.details?.available_payment_methods ?? [],
  });
});