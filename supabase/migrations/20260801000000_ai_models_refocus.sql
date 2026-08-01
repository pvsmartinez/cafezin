-- Migration: 20260801000000_ai_models_refocus
-- Refocuses the managed AI catalog around DeepSeek V4 Flash.
--
-- Syncs public.ai_config.basic_tier_models with the trimmed basic-tier
-- catalog shipped in app/src/services/aiProvider.ts (CAFEZIN_MANAGED_MODELS):
--   basic   = deepseek/deepseek-v4-flash (default), google/gemma-4-31b-it,
--             google/gemini-3.1-flash-lite
-- Removed stale/retired OpenRouter ids (gemini-2.0/2.5-flash, gemini-flash-1.5,
-- llama-3.3-70b-instruct, llama-4-scout, mistral-small-3.2,
-- deepseek-chat-v3-0324, deepseek-r1-0528-qwen3-8b).
--
-- Standard/pro tiers are unaffected (all models allowed).

INSERT INTO public.ai_config (key, value) VALUES (
  'basic_tier_models',
  '[
    "deepseek/deepseek-v4-flash",
    "google/gemma-4-31b-it",
    "google/gemini-3.1-flash-lite"
  ]'::jsonb
) ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = now();
