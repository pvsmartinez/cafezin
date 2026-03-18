-- Migration: 0004_account_billing
-- Provider-agnostic billing schema for Cafezin.
--
-- Design principles:
--   • Users can only READ their own subscription — all writes come from the
--     backend service role (webhook handlers, manual grants).
--   • The schema is completely independent of the payment provider; the
--     provider name is stored in a text column so Stripe / Paddle / manual / null
--     can coexist without schema changes.
--   • billing_events provides idempotent webhook processing: (provider, event_id)
--     is unique so duplicate deliveries are safely ignored.
--   • get_my_account_state() is the single source of truth consumed by apps.

-- ── user_subscriptions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'free' | 'premium'
  plan                     text        NOT NULL DEFAULT 'free',
  -- 'active' | 'trialing' | 'past_due' | 'canceled'
  status                   text        NOT NULL DEFAULT 'active',
  -- 'stripe' | 'paddle' | 'manual' | null
  provider                 text,
  provider_customer_id     text,
  provider_subscription_id text,
  provider_price_id        text,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean     NOT NULL DEFAULT false,
  trial_end                timestamptz,
  -- Arbitrary provider-specific metadata
  metadata                 jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own row; only service role can insert/update/delete.
CREATE POLICY "read own subscription"
  ON public.user_subscriptions
  FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ── billing_events (webhook idempotency log) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.billing_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       text        NOT NULL,
  event_id       text        NOT NULL,
  event_type     text        NOT NULL,
  user_id        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  payload        jsonb,
  processed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
-- No user-facing policies — only service role accesses this table.

-- ── RPC: get_my_account_state ─────────────────────────────────────────────────
-- Returns a unified JSON object describing the current user's account state.
-- Apps call this once at startup and after auth events; result is cached locally.

CREATE OR REPLACE FUNCTION public.get_my_account_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := (select auth.uid());
  v_sub       public.user_subscriptions%ROWTYPE;
  v_is_premium boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated',     false,
      'plan',              'free',
      'status',            'inactive',
      'isPremium',         false,
      'canUseAI',          false,
      'currentPeriodEnd',  null,
      'cancelAtPeriodEnd', false,
      'trialEnd',          null
    );
  END IF;

  SELECT * INTO v_sub
    FROM public.user_subscriptions
   WHERE user_id = v_user_id;

  IF FOUND THEN
    v_is_premium := (
      v_sub.plan = 'premium'
      AND v_sub.status IN ('active', 'trialing')
      AND (v_sub.current_period_end IS NULL OR v_sub.current_period_end > now())
    );
  END IF;

  RETURN jsonb_build_object(
    'authenticated',     true,
    'plan',              COALESCE(v_sub.plan,   'free'),
    'status',            COALESCE(v_sub.status, 'inactive'),
    'isPremium',         v_is_premium,
    'canUseAI',          v_is_premium,
    'currentPeriodEnd',  v_sub.current_period_end,
    'cancelAtPeriodEnd', COALESCE(v_sub.cancel_at_period_end, false),
    'trialEnd',          v_sub.trial_end
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_account_state() TO authenticated;
