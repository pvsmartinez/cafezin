/**
 * price-preview — Public Paddle pricing preview for Cafezin landing pages.
 *
 * GET /functions/v1/price-preview?country=BR&currency=BRL
 *
 * Uses Paddle's pricing preview API to return localized, formatted amounts
 * for all Cafezin subscription tiers (basic, standard, pro) in a single request.
 *
 * Required secrets:
 *   PADDLE_API_KEY           — from Paddle Dashboard → Developer → Authentication
 *   PADDLE_PRICE_ID_BASIC    — Basic tier price ID (format: pri_...)
 *   PADDLE_PRICE_ID_STANDARD — Standard tier price ID
 *   PADDLE_PRICE_ID_PRO      — Pro tier price ID
 *   PADDLE_PRICE_ID          — legacy fallback (used as basic if BASIC not set)
 *   PADDLE_ENVIRONMENT       — 'sandbox' or 'production'
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
  const environment = Deno.env.get('PADDLE_ENVIRONMENT') ?? 'production';

  if (!apiKey) {
    return json({ error: 'Paddle pricing preview is not configured' }, 500);
  }

  // Collect monthly + annual price IDs into a unified list.
  type PriceEntry = { tier: string; interval: 'monthly' | 'annual'; priceId: string };
  const allPrices: PriceEntry[] = [];
  const priceIdToEntry = new Map<string, PriceEntry>();

  function addPrice(tier: string, interval: 'monthly' | 'annual', id: string | undefined) {
    if (!id) return;
    const entry: PriceEntry = { tier, interval, priceId: id };
    allPrices.push(entry);
    priceIdToEntry.set(id, entry);
  }

  addPrice('basic',    'monthly', Deno.env.get('PADDLE_PRICE_ID_BASIC')    ?? Deno.env.get('PADDLE_PRICE_ID'));
  addPrice('standard', 'monthly', Deno.env.get('PADDLE_PRICE_ID_STANDARD'));
  addPrice('pro',      'monthly', Deno.env.get('PADDLE_PRICE_ID_PRO'));
  addPrice('basic',    'annual',  Deno.env.get('PADDLE_PRICE_ID_BASIC_ANNUAL'));
  addPrice('standard', 'annual',  Deno.env.get('PADDLE_PRICE_ID_STANDARD_ANNUAL'));
  addPrice('pro',      'annual',  Deno.env.get('PADDLE_PRICE_ID_PRO_ANNUAL'));

  if (allPrices.length === 0) {
    return json({ error: 'No Paddle price IDs configured' }, 500);
  }

  const baseUrl = environment === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';

  const url = new URL(req.url);
  const countryCode = parseCountry(url.searchParams.get('country'));
  const currencyCode = parseCurrency(url.searchParams.get('currency'));
  const clientIp = getClientIp(req);

  const paddleBody: Record<string, unknown> = {
    items: allPrices.map((e) => ({ price_id: e.priceId, quantity: 1 })),
  };

  if (countryCode) {
    paddleBody.address = { country_code: countryCode, postal_code: null };
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
  const resolvedCurrency = data?.currency_code ?? currencyCode ?? 'USD';

  const lineItems: unknown[] = data?.details?.line_items ?? data?.items ?? [];
  const monthly: Record<string, string> = {};
  const annual: Record<string, string> = {};

  for (const li of lineItems) {
    const lineItem = li as Record<string, unknown>;
    const priceId: string =
      ((lineItem?.price as Record<string, unknown>)?.id as string) ??
      ((lineItem as Record<string, unknown>)?.price_id as string) ?? '';
    const entry = priceIdToEntry.get(priceId);
    if (!entry) continue;

    const formatted =
      ((lineItem?.formatted_totals as Record<string, unknown>)?.total as string) ??
      ((lineItem?.formatted_unit_totals as Record<string, unknown>)?.total as string) ??
      formatMinorUnits(
        (((lineItem?.totals as Record<string, unknown>)?.total as string) ?? null),
        resolvedCurrency,
      );

    if (formatted) {
      if (entry.interval === 'monthly') monthly[entry.tier] = formatted;
      else annual[entry.tier] = formatted;
    }
  }

  if (Object.keys(monthly).length === 0 && Object.keys(annual).length === 0) {
    return json({ error: 'Paddle preview did not return formatted amounts' }, 502);
  }

  return json({
    monthly,
    annual,
    // Legacy fields — keep for backwards compatibility.
    tiers: monthly,
    amountFormatted: monthly.basic ?? Object.values(monthly)[0],
    currencyCode: resolvedCurrency,
    countryCode: (data?.address as Record<string, unknown>)?.country_code ?? countryCode,
    availablePaymentMethods: data?.details?.available_payment_methods ?? [],
  });
});