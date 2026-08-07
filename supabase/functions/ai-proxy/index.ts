/**
 * ai-proxy — Managed AI endpoint for Cafezin subscribers.
 *
 * Validates the calling user's JWT, checks their monthly quota in ai_usage,
 * forwards the request to OpenRouter using the server-side key, streams the
 * response back to the client, then debits the actual cost.
 *
 * POST /functions/v1/ai-proxy
 * Authorization: Bearer <supabase-access-token>
 * Content-Type: application/json
 *
 * Body (OpenAI-compatible):
 *   { model: string, messages: ChatMessage[], max_tokens?: number, temperature?: number }
 *
 * Response: SSE text/event-stream (OpenAI-compatible format)
 *
 * Error codes:
 *   401 — not authenticated or no managed AI subscription
 *   402 — quota exceeded for this billing cycle
 *   422 — missing/invalid body
 *   502 — OpenRouter error
 *
 * Required secrets (supabase secrets set --project-ref dxxwlnvemqgpdrnkzrcr):
 *   OPENROUTER_API_KEY  — server-side OpenRouter key (never exposed to client)
 *
 * Tier → model allowlist + quota (in USD micro-cents, 1 USD = 10_000 mc):
 *   basic    — $2.00/mo    = 20_000 mc — only 'basic' tier models
 *   standard — $15.00/mo   = 150_000 mc — all models
 *   pro      — $40.00/mo   = 400_000 mc — all models
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Tier config ───────────────────────────────────────────────────────────────

const TIER_LIMITS_MC: Record<string, number> = {
  basic:    20_000,    // $2.00
  standard: 150_000,   // $15.00
  pro:      400_000,   // $40.00
};

/**
 * Fallback list used only if the ai_config table is unreachable.
 * The canonical list lives in: public.ai_config WHERE key = 'basic_tier_models'
 * Update it via SQL — no redeploy needed.
 */
const BASIC_TIER_MODELS_FALLBACK: string[] = [
  'deepseek/deepseek-v4-flash',
  'google/gemma-4-31b-it',
  'google/gemini-3.1-flash-lite',
];

// Module-level cache — shared across requests within the same isolate lifetime.
let _basicTierModelsCache: string[] | null = null;
let _basicTierCachedAt = 0;
const BASIC_TIER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getBasicTierModels(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  const now = Date.now();
  if (_basicTierModelsCache && now - _basicTierCachedAt < BASIC_TIER_CACHE_TTL_MS) {
    return _basicTierModelsCache;
  }

  const { data, error } = await supabase
    .from('ai_config')
    .select('value')
    .eq('key', 'basic_tier_models')
    .single();

  if (error || !data?.value || !Array.isArray(data.value)) {
    console.warn('[ai-proxy] Failed to load basic_tier_models from DB, using fallback', error?.message);
    return BASIC_TIER_MODELS_FALLBACK;
  }

  _basicTierModelsCache = data.value as string[];
  _basicTierCachedAt = now;
  return _basicTierModelsCache;
}

function isModelAllowedForTier(model: string, tier: string, basicModels: string[]): boolean {
  if (tier === 'standard' || tier === 'pro') return true;
  if (tier === 'basic') return basicModels.includes(model);
  return false;
}

// ── Cost parsing helpers ──────────────────────────────────────────────────────

/**
 * OpenRouter returns cost in USD as a float in the usage.cost field on the
 * final chunk, or in x-openrouter-credits-cost response header.
 * Convert to micro-cents (integer) to avoid float precision issues.
 */
function dollarToMicrocents(dollars: number): bigint {
  // multiply by 10_000 (since 1 USD = 10_000 mc), round to nearest integer
  return BigInt(Math.round(dollars * 10_000));
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const token      = authHeader.replace('Bearer ', '').trim();
  const trialToken = req.headers.get('X-Trial-Token') ?? '';

  // ── Anonymous trial path ──────────────────────────────────────────────────
  // No account required. Client-side localStorage caps at 3 uses; server just
  // validates the token is a valid UUID and forwards to OpenRouter with the
  // cheapest available model. No quota is debited.
  if (!token && trialToken) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(trialToken)) {
      return new Response(JSON.stringify({ error: 'Invalid trial token' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    let trialBody: {
      model?: string;
      messages?: unknown[];
      max_tokens?: number;
      temperature?: number;
      tools?: unknown[];
      tool_choice?: unknown;
    };
    try {
      trialBody = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 422,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!Array.isArray(trialBody.messages) || trialBody.messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages are required' }), {
        status: 422,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Always use the cheapest basic-tier model regardless of what client requests
    const trialModel = BASIC_TIER_MODELS_FALLBACK[0]; // 'google/gemma-4-31b-it'

    const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openRouterKey) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const orTrialRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${openRouterKey}`,
        'Content-Type':   'application/json',
        'HTTP-Referer':   'https://cafezin.pmatz.com',
        'X-Title':        'Cafezin',
      },
      body: JSON.stringify({
        model:       trialModel,
        messages:    trialBody.messages,
        max_tokens:  trialBody.max_tokens ?? 4096,
        temperature: trialBody.temperature ?? 0.7,
        ...(trialBody.tools ? { tools: trialBody.tools } : {}),
        ...(trialBody.tool_choice ? { tool_choice: trialBody.tool_choice } : {}),
        stream:      true,
      }),
    });

    if (!orTrialRes.ok || !orTrialRes.body) {
      const errText = await orTrialRes.text().catch(() => '(no body)');
      console.error('[ai-proxy] trial OpenRouter error', orTrialRes.status, errText);
      return new Response(
        JSON.stringify({ error: 'upstream_error', message: `OpenRouter ${orTrialRes.status}` }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(orTrialRes.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // ── Authenticated (paid plan) path ────────────────────────────────────────
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Schema `cafezin` — cobre também a RPC increment_ai_usage.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'cafezin' } },
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: {
    model?: string;
    messages?: unknown[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    tools?: unknown[];
    tool_choice?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 422,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const model = (body.model ?? '').trim();
  if (!model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: 'model and messages are required' }), {
      status: 422,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Quota check ───────────────────────────────────────────────────────────
  const { data: usageRow } = await supabase
    .from('ai_usage')
    .select('tier, credits_used_microcents, credits_limit_microcents, reset_at')
    .eq('user_id', user.id)
    .single();

  if (!usageRow || usageRow.tier === 'none' || Number(usageRow.credits_limit_microcents) <= 0) {
    return new Response(JSON.stringify({ error: 'no_managed_ai_plan', message: 'Basic or higher plan required' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const tier = usageRow.tier as string;
  const used  = Number(usageRow.credits_used_microcents);
  const limit = Number(usageRow.credits_limit_microcents);

  // Auto-reset if the billing cycle has ended
  const resetAt = new Date(usageRow.reset_at as string).getTime();
  if (Date.now() > resetAt) {
    await supabase
      .from('ai_usage')
      .update({
        credits_used_microcents: 0,
        cycle_start: new Date().toISOString(),
        reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);
    // Allow the call to proceed with a fresh quota
  } else if (used >= limit) {
    const remaining = 0;
    const resetDate = new Date(usageRow.reset_at as string).toISOString();
    return new Response(
      JSON.stringify({
        error: 'quota_exceeded',
        message: 'Monthly AI quota reached',
        used_microcents: used,
        limit_microcents: limit,
        remaining_microcents: remaining,
        resets_at: resetDate,
      }),
      {
        status: 402,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  // ── Model allowlist ───────────────────────────────────────────────────────
  const basicModels = await getBasicTierModels(supabase);
  if (!isModelAllowedForTier(model, tier, basicModels)) {
    return new Response(
      JSON.stringify({ error: 'model_not_allowed', message: `Model "${model}" is not available on the ${tier} tier` }),
      { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // ── Forward to OpenRouter ─────────────────────────────────────────────────
  const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!openRouterKey) {
    console.error('OPENROUTER_API_KEY secret not set');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${openRouterKey}`,
      'Content-Type':   'application/json',
      'HTTP-Referer':   'https://cafezin.pmatz.com',
      'X-Title':        'Cafezin',
    },
    body: JSON.stringify({
      model,
      messages:      body.messages,
      max_tokens:    body.max_tokens    ?? 4096,
      temperature:   body.temperature  ?? 0.7,
      ...(body.tools ? { tools: body.tools } : {}),
      ...(body.tool_choice ? { tool_choice: body.tool_choice } : {}),
      stream:        true,
      // Ask OpenRouter to include usage in the final chunk
      usage: { include: true },
    }),
  });

  if (!orRes.ok || !orRes.body) {
    const errText = await orRes.text().catch(() => '(no body)');
    console.error('OpenRouter error', orRes.status, errText);
    return new Response(
      JSON.stringify({ error: 'upstream_error', message: `OpenRouter ${orRes.status}` }),
      { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // ── Stream + debit cost ───────────────────────────────────────────────────
  // We need to:
  //   1. Stream chunks verbatim to the client (SSE passthrough)
  //   2. Watch for the final chunk that contains usage.cost
  //   3. After stream ends, call increment_ai_usage RPC with the cost

  let costMicrocents = BigInt(0);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const decoder = new TextDecoder();

  (async () => {
    const reader = orRes.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Write chunk to client
        await writer.write(value);

        // Scan for cost in the final data chunk
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const chunk = JSON.parse(raw) as {
              usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
            };
            if (chunk.usage?.cost && chunk.usage.cost > 0) {
              costMicrocents = dollarToMicrocents(chunk.usage.cost);
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } finally {
      await writer.close().catch(() => {});

      // Debit cost — fire-and-forget; failure is logged but doesn't affect the client.
      if (costMicrocents > 0n) {
        const { error: rpcErr } = await supabase.rpc('increment_ai_usage', {
          p_user_id:    user.id,
          p_microcents: String(costMicrocents), // JSON serializes bigint as string
        });
        if (rpcErr) {
          console.error('[ai-proxy] increment_ai_usage failed:', rpcErr);
        }
      }
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
});
