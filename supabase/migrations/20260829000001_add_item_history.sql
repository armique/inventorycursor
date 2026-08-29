-- ==============================================================================
-- ADD HISTORY JSONB AUDIT COLUMN TO INVENTORY_ITEMS
-- ==============================================================================

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]'::jsonb;
