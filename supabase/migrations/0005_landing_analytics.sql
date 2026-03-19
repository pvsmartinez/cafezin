-- Migration: 0005_landing_analytics
-- Public landing analytics for Cafezin and lightweight contact intake support.

CREATE TABLE IF NOT EXISTS public.landing_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text        NOT NULL,
  page_path  text        NOT NULL,
  locale     text,
  platform   text,
  referrer   text,
  metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.landing_events ENABLE ROW LEVEL SECURITY;

-- No user-facing policies. Inserts and reads happen via service role only.

CREATE INDEX IF NOT EXISTS landing_events_created_at_idx
  ON public.landing_events (created_at DESC);

CREATE INDEX IF NOT EXISTS landing_events_name_created_at_idx
  ON public.landing_events (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS landing_events_page_created_at_idx
  ON public.landing_events (page_path, created_at DESC);