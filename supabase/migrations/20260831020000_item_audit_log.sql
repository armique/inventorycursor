-- Permanent, queryable audit log of every inventory change.
--
-- Why this exists alongside the per-item history:
--   inventory_items.history already stores rich field-level diffs, but it is
--   capped at 100 entries per item, can only be read one item at a time, and is
--   deleted along with the item. So "every refund in August" is unanswerable,
--   and deleting an item destroys the record of what was done to it — which is
--   exactly the history the owner needs for refunds, cancellations and price
--   changes.
--
-- Design decisions that matter:
--
--   item_id is TEXT with NO foreign key, deliberately. A FK with ON DELETE
--   CASCADE would erase an item's audit trail the moment it is deleted, which
--   defeats the purpose. item_name is denormalised for the same reason: the log
--   must stay readable after the item is gone.
--
--   diffs holds [{field, from, to, label}] exactly as computeItemHistoryDiff
--   produces, so old and new values are both recoverable — not just "changed".
--
--   occurred_at is when the change happened on the device; created_at is when
--   the row reached Supabase. They differ when a write is queued offline, and
--   keeping both makes an out-of-order arrival visible rather than confusing.

CREATE TABLE IF NOT EXISTS public.item_audit_log (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    item_id TEXT,
    item_name TEXT,

    action TEXT NOT NULL,
    title TEXT,
    details TEXT,
    actor TEXT,

    diffs JSONB NOT NULL DEFAULT '[]'::jsonb,

    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Timeline view: "what happened, newest first".
CREATE INDEX IF NOT EXISTS idx_item_audit_user_time
    ON public.item_audit_log (user_id, occurred_at DESC);

-- Per-item view: "everything that ever happened to this item".
CREATE INDEX IF NOT EXISTS idx_item_audit_user_item
    ON public.item_audit_log (user_id, item_id, occurred_at DESC);

-- Filtered view: "every refund / every price change in a period".
CREATE INDEX IF NOT EXISTS idx_item_audit_user_action
    ON public.item_audit_log (user_id, action, occurred_at DESC);

ALTER TABLE public.item_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can read and append their audit log" ON public.item_audit_log;
CREATE POLICY "Owner can read and append their audit log"
    ON public.item_audit_log FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
