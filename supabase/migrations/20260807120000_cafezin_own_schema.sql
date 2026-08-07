-- Move o cafezin de `public` para o schema `cafezin`.
--
-- Motivo: o projeto Supabase dxxwlnvemqgpdrnkzrcr é compartilhado por 11 apps. Nomes como
-- `user_secrets`, `user_subscriptions` e `ai_usage` em `public` sequestram o namespace comum —
-- o próximo app que precisar de qualquer um deles colide.
--
-- `ALTER ... SET SCHEMA` é metadata-only: dados, índices, FKs e policies RLS viajam junto.
-- Idempotente: os guards deixam a migration repetível.

create schema if not exists cafezin;

grant usage on schema cafezin to anon, authenticated, service_role;

do $$
declare
  t text;
  tables text[] := array[
    'ai_config',
    'ai_usage',
    'billing_events',
    'landing_events',
    'synced_workspaces',
    'user_secrets',
    'user_subscriptions'
  ];
begin
  foreach t in array tables loop
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      execute format('alter table public.%I set schema cafezin', t);
    end if;
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_my_account_state'
  ) then
    alter function public.get_my_account_state() set schema cafezin;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'increment_ai_usage'
  ) then
    alter function public.increment_ai_usage(uuid, bigint) set schema cafezin;
  end if;
end
$$;

-- As duas funções qualificavam `public.` no corpo e no %ROWTYPE, e fixavam
-- search_path='public'. Mover a função não reescreve isso — sem recriar, ambas quebram.
create or replace function cafezin.get_my_account_state()
returns jsonb
language plpgsql
security definer
set search_path to 'cafezin'
as $function$
DECLARE
  v_user_id   uuid := (select auth.uid());
  v_sub       cafezin.user_subscriptions%ROWTYPE;
  v_usage     cafezin.ai_usage%ROWTYPE;
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
    FROM cafezin.user_subscriptions
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
    FROM cafezin.ai_usage
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
$function$;

create or replace function cafezin.increment_ai_usage(p_user_id uuid, p_microcents bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'cafezin'
as $function$
DECLARE
  v_row cafezin.ai_usage%ROWTYPE;
BEGIN
  UPDATE cafezin.ai_usage
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
$function$;

-- As duas são chamadas por RPC do cliente; sem EXECUTE explícito o PostgREST devolve 404.
grant execute on function cafezin.get_my_account_state() to anon, authenticated, service_role;
grant execute on function cafezin.increment_ai_usage(uuid, bigint) to service_role;

alter default privileges in schema cafezin
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
