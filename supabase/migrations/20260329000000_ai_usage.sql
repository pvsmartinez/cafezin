-- Migration: 20260329000000_ai_usage
-- Per-user AI quota tracking for Cafezin managed AI (OpenRouter proxy).
--
-- Design:
--   • ai_usage tracks cumulative credits consumed this billing cycle (in USD micro-cents = 1/100 of cent)
--     Using integer micro-cents to avoid float precision issues.
--     1 USD = 100 cents = 10_000 micro-cents.
--   • credits_used_microcents and credits_limit_microcents: e.g. $2 limit = 20_000 mc.
--   • tier is denormalized from user_subscriptions for fast reads in the proxy function.
--   • reset_at is set to the end of the current billing period (synced from Paddle).
--   • Only service role writes; users read their own row.

CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id                  uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'basic' | 'standard' | 'pro'
  tier                     text        NOT NULL DEFAULT 'basic',
  -- Cumulative OpenRouter cost this cycle (in micro-cents: 1 USD = 10_000)
  credits_used_microcents  bigint      NOT NULL DEFAULT 0,
  -- Monthly quota ceiling (micro-cents). Updated by billing-webhook on subscription events.
  credits_limit_microcents bigint      NOT NULL DEFAULT 0,
  -- Start of the current billing cycle
  cycle_start              timestamptz NOT NULL DEFAULT now(),
  -- When this cycle resets (mirrors current_period_end from user_subscriptions)
  reset_at                 timestamptz NOT NULL DEFAULT (now() + interval '1 month'),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Users can read their own row; service role handles all writes.
CREATE POLICY "read own ai_usage"
  ON public.ai_usage
  FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ── RPC: get_my_account_state (updated to include AI quota) ──────────────────
-- Replaces the existing function from migration 0004.

CREATE OR REPLACE FUNCTION public.get_my_account_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := (select auth.uid());
  v_sub       public.user_subscriptions%ROWTYPE;
  v_usage     public.ai_usage%ROWTYPE;
  v_is_premium boolean := false;
  v_ai_tier    text := 'none';
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated',          false,
      'plan',                   'free',
      'status',                 'inactive',
      'isPremium',              false,
      'canUseAI',               false,
      'currentPeriodEnd',       null,
      'cancelAtPeriodEnd',      false,
      'trialEnd',               null,
      'aiTier',                 'none',
      'aiCreditsUsedMicrocents', 0,
      'aiCreditsLimitMicrocents', 0
    );
  END IF;

  SELECT * INTO v_sub
    FROM public.user_subscriptions
   WHERE user_id = v_user_id;

  IF FOUND THEN
    v_is_premium := (
      v_sub.plan IN ('basic', 'standard', 'pro', 'premium')
      AND v_sub.status IN ('active', 'trialing')
      AND (v_sub.current_period_end IS NULL OR v_sub.current_period_end > now())
    );
  END IF;

  -- Resolve AI tier from subscription plan
  IF v_is_premium THEN
    v_ai_tier := CASE
      WHEN v_sub.plan = 'pro'      THEN 'pro'
      WHEN v_sub.plan = 'standard' THEN 'standard'
      WHEN v_sub.plan = 'basic'    THEN 'basic'
      WHEN v_sub.plan = 'premium'  THEN 'basic'  -- legacy plan maps to basic
      ELSE 'none'
    END;
  END IF;

  SELECT * INTO v_usage
    FROM public.ai_usage
   WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'authenticated',             true,
    'plan',                      COALESCE(v_sub.plan,   'free'),
    'status',                    COALESCE(v_sub.status, 'inactive'),
    'isPremium',                 v_is_premium,
    'canUseAI',                  v_is_premium,
    'currentPeriodEnd',          v_sub.current_period_end,
    'cancelAtPeriodEnd',         COALESCE(v_sub.cancel_at_period_end, false),
    'trialEnd',                  v_sub.trial_end,
    'aiTier',                    v_ai_tier,
    'aiCreditsUsedMicrocents',   COALESCE(v_usage.credits_used_microcents, 0),
    'aiCreditsLimitMicrocents',  COALESCE(v_usage.credits_limit_microcents, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_account_state() TO authenticated;

-- ── RPC: increment_ai_usage ───────────────────────────────────────────────────
-- Called by the ai-proxy edge function (service role) after each successful LLM call.
-- Returns the new running total and remaining quota so the caller can surface it.

CREATE OR REPLACE FUNCTION public.increment_ai_usage(
  p_user_id        uuid,
  p_microcents     bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ai_usage%ROWTYPE;
BEGIN
  UPDATE public.ai_usage
     SET credits_used_microcents = credits_used_microcents + p_microcents,
         updated_at              = now()
   WHERE user_id = p_user_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_usage row not found for user %', p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'used',      v_row.credits_used_microcents,
    'limit',     v_row.credits_limit_microcents,
    'remaining', GREATEST(0, v_row.credits_limit_microcents - v_row.credits_used_microcents)
  );
END;
$$;

-- Only service role can call this (no GRANT to authenticated).
