-- Enable Supabase Realtime for cross-device sync.
--
-- Without this, a realtime subscription connects successfully and then silently
-- receives nothing: Postgres only streams changes for tables that are members of
-- the `supabase_realtime` publication.
--
-- REPLICA IDENTITY FULL is required for DELETE to work correctly here. With the
-- default replica identity a DELETE event carries only the primary key, so
-- Postgres cannot evaluate the `user_id=eq.<uid>` filter the client subscribes
-- with, and RLS drops the event — deletions made on one device would never reach
-- the others. FULL includes the whole old row, so the filter and RLS can both be
-- applied. The extra WAL volume is negligible at this table's size.

ALTER TABLE public.inventory_items REPLICA IDENTITY FULL;
ALTER TABLE public.user_profiles REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'inventory_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
  END IF;
END
$$;
