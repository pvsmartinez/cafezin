-- ─── Fix: Auth RLS Initialization Plan ───────────────────────────────────────
-- Wrap auth.uid() in (select auth.uid()) so Postgres evaluates the session
-- value once per statement instead of once per row.
-- Affected: synced_workspaces "own workspaces only", user_secrets "own secrets only"
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── synced_workspaces ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "own workspaces only" ON synced_workspaces;

CREATE POLICY "own workspaces only" ON synced_workspaces
  FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ─── user_secrets ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "own secrets only" ON user_secrets;

CREATE POLICY "own secrets only" ON user_secrets
  FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
