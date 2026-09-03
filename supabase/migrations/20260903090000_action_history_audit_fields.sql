-- =============================================================================
-- Action history: Part B fields (diff snapshots, operation grouping, append-only)
-- =============================================================================
-- Safe to re-run. Drops existing RLS first so UPDATEs cannot hit
-- `auth.uid() = user_id` (uuid = text) on a TEXT user_id column.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.uid_eq(p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid() IS NOT NULL AND auth.uid()::text = p_user_id;
$$;

-- Drop every existing policy before any DML (covers uuid vs text RLS).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'action_history'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.action_history', r.policyname);
  END LOOP;

  IF to_regclass('public.item_audit_log') IS NOT NULL THEN
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'item_audit_log'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.item_audit_log', r.policyname);
    END LOOP;
  END IF;
END $$;

ALTER TABLE public.action_history DISABLE ROW LEVEL SECURITY;

-- --- action_history columns ---------------------------------------------------
ALTER TABLE public.action_history
  ADD COLUMN IF NOT EXISTS action_type TEXT,
  ADD COLUMN IF NOT EXISTS previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS related_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS operation_id TEXT,
  ADD COLUMN IF NOT EXISTS operation_label TEXT;

ALTER TABLE public.action_history
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE public.action_history
SET created_at = COALESCE(created_at, "timestamp", NOW())
WHERE created_at IS NULL;

ALTER TABLE public.action_history
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE public.action_history
  ALTER COLUMN created_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.action_history_sync_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_at IS NULL AND NEW."timestamp" IS NOT NULL THEN
    NEW.created_at := NEW."timestamp";
  ELSIF NEW."timestamp" IS NULL AND NEW.created_at IS NOT NULL THEN
    NEW."timestamp" := NEW.created_at;
  ELSIF NEW.created_at IS NULL AND NEW."timestamp" IS NULL THEN
    NEW.created_at := NOW();
    NEW."timestamp" := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_action_history_sync_timestamps ON public.action_history;
CREATE TRIGGER trg_action_history_sync_timestamps
  BEFORE INSERT OR UPDATE ON public.action_history
  FOR EACH ROW
  EXECUTE FUNCTION public.action_history_sync_timestamps();

UPDATE public.action_history
SET action_type = CASE
  WHEN action ILIKE 'Item created%' THEN 'created'
  WHEN action ILIKE 'Item deleted%' THEN 'item_deleted'
  WHEN action ILIKE '%split%' THEN 'bundle_split'
  WHEN action ILIKE '%bundle%' AND action ILIKE '%added%' THEN 'added_to_bundle'
  WHEN action ILIKE '%removed from%' OR action ILIKE '%returned to stock%' THEN 'removed_from_bundle'
  WHEN action ILIKE 'Buy price%' THEN 'buy_price_changed'
  WHEN action ILIKE 'Sell price%' THEN 'sell_price_changed'
  WHEN action ILIKE 'Status%' THEN 'status_changed'
  WHEN action ILIKE '%undo%' OR action ILIKE '%revert%' OR action ILIKE '%rollback%' THEN 'rollback'
  ELSE COALESCE(NULLIF(action_type, ''), 'general_edit')
END
WHERE action_type IS NULL OR action_type = '';

CREATE INDEX IF NOT EXISTS idx_action_history_user_item
  ON public.action_history (user_id, item_id);

CREATE INDEX IF NOT EXISTS idx_action_history_user_created
  ON public.action_history (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_action_history_user_operation
  ON public.action_history (user_id, operation_id)
  WHERE operation_id IS NOT NULL;

ALTER TABLE public.action_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own action history"
  ON public.action_history FOR SELECT
  USING (public.uid_eq(user_id::text));

CREATE POLICY "Users can append their own action history"
  ON public.action_history FOR INSERT
  WITH CHECK (public.uid_eq(user_id::text));

-- --- item_audit_log -----------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.item_audit_log') IS NULL THEN
    RAISE NOTICE 'item_audit_log missing — skipping audit-log hardening';
    RETURN;
  END IF;

  ALTER TABLE public.item_audit_log DISABLE ROW LEVEL SECURITY;

  ALTER TABLE public.item_audit_log
    ADD COLUMN IF NOT EXISTS operation_id TEXT,
    ADD COLUMN IF NOT EXISTS operation_label TEXT,
    ADD COLUMN IF NOT EXISTS related_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

  CREATE INDEX IF NOT EXISTS idx_item_audit_user_operation
    ON public.item_audit_log (user_id, operation_id)
    WHERE operation_id IS NOT NULL;

  ALTER TABLE public.item_audit_log ENABLE ROW LEVEL SECURITY;

  EXECUTE $p$
    CREATE POLICY "Owner can read their audit log"
      ON public.item_audit_log FOR SELECT
      USING (public.uid_eq(user_id::text))
  $p$;
  EXECUTE $p$
    CREATE POLICY "Owner can append their audit log"
      ON public.item_audit_log FOR INSERT
      WITH CHECK (public.uid_eq(user_id::text))
  $p$;
END $$;

COMMENT ON COLUMN public.inventory_items.component_ids IS
  'Canonical child list (Part A child_item_ids). Always keep in sync with reverse links.';
COMMENT ON COLUMN public.inventory_items.parent_container_id IS
  'Canonical parent pointer (Part A bundle_id). Child points at its container.';
COMMENT ON COLUMN public.inventory_items.buy_price IS
  'What was paid. Containers hold the whole purchase; children under a parent are excluded from capital totals.';
COMMENT ON COLUMN public.inventory_items.is_defective IS
  'Defective / for-parts flag (Part A condition).';
COMMENT ON COLUMN public.inventory_items.movement_history IS
  'JSONB membership trail (added_to_bundle / removed_from_bundle).';
COMMENT ON COLUMN public.inventory_items.price_history IS
  'JSONB buy/sell price change trail.';
