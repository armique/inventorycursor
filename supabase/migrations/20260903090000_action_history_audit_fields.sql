-- =============================================================================
-- Action history: Part B fields (diff snapshots, operation grouping, append-only)
-- =============================================================================
-- ArmikTech already has inventory_items.buy_price, component_ids (≈ child_item_ids),
-- parent_container_id (≈ bundle_id), movement_history, price_history, is_defective.
-- Those are NOT recreated here — see comments at the bottom.
--
-- MANDATORY before the new audit/undo UI can persist operation groups + diffs
-- to Supabase (localStorage still works without this migration):
--   1) This entire file
--
-- OPTIONAL (already present elsewhere):
--   - item_audit_log (20260831020000_item_audit_log.sql)
--   - inventory_items.history / movement_history / price_history
-- =============================================================================

-- --- action_history columns ---------------------------------------------------
ALTER TABLE public.action_history
  ADD COLUMN IF NOT EXISTS action_type TEXT,
  ADD COLUMN IF NOT EXISTS previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS related_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS operation_id TEXT,
  ADD COLUMN IF NOT EXISTS operation_label TEXT;

-- Friendly alias: Part B uses created_at; ArmikTech historically used timestamp.
ALTER TABLE public.action_history
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE public.action_history
SET created_at = COALESCE(created_at, timestamp, NOW())
WHERE created_at IS NULL;

ALTER TABLE public.action_history
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE public.action_history
  ALTER COLUMN created_at SET NOT NULL;

-- Keep timestamp in sync for older readers when only created_at is written.
CREATE OR REPLACE FUNCTION public.action_history_sync_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_at IS NULL AND NEW.timestamp IS NOT NULL THEN
    NEW.created_at := NEW.timestamp;
  ELSIF NEW.timestamp IS NULL AND NEW.created_at IS NOT NULL THEN
    NEW.timestamp := NEW.created_at;
  ELSIF NEW.created_at IS NULL AND NEW.timestamp IS NULL THEN
    NEW.created_at := NOW();
    NEW.timestamp := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_action_history_sync_timestamps ON public.action_history;
CREATE TRIGGER trg_action_history_sync_timestamps
  BEFORE INSERT OR UPDATE ON public.action_history
  FOR EACH ROW
  EXECUTE FUNCTION public.action_history_sync_timestamps();

-- Backfill action_type from free-string action when empty (ArmikTech verbs stay as `action`).
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

-- Append-only: owners may SELECT + INSERT. No UPDATE / DELETE for normal roles.
DROP POLICY IF EXISTS "Users can manage their own action history" ON public.action_history;

DROP POLICY IF EXISTS "Users can read their own action history" ON public.action_history;
CREATE POLICY "Users can read their own action history"
  ON public.action_history FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can append their own action history" ON public.action_history;
CREATE POLICY "Users can append their own action history"
  ON public.action_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- --- item_audit_log: operation grouping + append-only hardening --------------
ALTER TABLE public.item_audit_log
  ADD COLUMN IF NOT EXISTS operation_id TEXT,
  ADD COLUMN IF NOT EXISTS operation_label TEXT,
  ADD COLUMN IF NOT EXISTS related_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_item_audit_user_operation
  ON public.item_audit_log (user_id, operation_id)
  WHERE operation_id IS NOT NULL;

DROP POLICY IF EXISTS "Owner can read and append their audit log" ON public.item_audit_log;

DROP POLICY IF EXISTS "Owner can read their audit log" ON public.item_audit_log;
CREATE POLICY "Owner can read their audit log"
  ON public.item_audit_log FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner can append their audit log" ON public.item_audit_log;
CREATE POLICY "Owner can append their audit log"
  ON public.item_audit_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- Naming map (no duplicate columns — ArmikTech names are canonical)
-- =============================================================================
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
