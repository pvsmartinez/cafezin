-- Migration: 20260408000000_ai_config
-- Stores server-side AI configuration that can be updated without redeploying
-- the ai-proxy edge function (no build required).
--
-- The edge function reads 'basic_tier_models' on each request (cached 5 min in-memory).
-- To update the allowlist without redeploy:
--   UPDATE public.ai_config SET value = '["google/gemma-4-31b-it", ...]'::jsonb WHERE key = 'basic_tier_models';

CREATE TABLE IF NOT EXISTS public.ai_config (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- No client access — only service_role (edge functions) can read/write
ALTER TABLE public.ai_config ENABLE ROW LEVEL SECURITY;

-- Seed: basic tier model allowlist (in priority / display order)
INSERT INTO public.ai_config (key, value) VALUES (
  'basic_tier_models',
  '[
    "google/gemma-4-31b-it",
    "google/gemini-2.0-flash",
    "google/gemini-2.5-flash",
    "google/gemini-flash-1.5",
    "meta-llama/llama-3.3-70b-instruct",
    "meta-llama/llama-4-scout",
    "mistralai/mistral-small-3.2",
    "deepseek/deepseek-chat-v3-0324",
    "deepseek/deepseek-r1-0528-qwen3-8b"
  ]'::jsonb
) ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = now();
