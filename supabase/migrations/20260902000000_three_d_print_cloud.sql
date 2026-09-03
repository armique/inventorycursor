-- 3D print calculator + filament stock synced via user_profiles (same as local three_d_print_cloud_v1).
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS three_d_print_cloud JSONB;
