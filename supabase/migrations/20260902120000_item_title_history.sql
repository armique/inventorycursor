-- Past listing / inventory titles for restore-from-history in the item card.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS title_history JSONB DEFAULT '[]'::jsonb;
