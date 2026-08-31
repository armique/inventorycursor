-- Storefront tables.
--
-- These were never created when the app moved off Firebase, so the public shop
-- had no data source: subscribeToStoreCatalog / subscribeToStorefrontConfig both
-- errored, the page fell back to defaults, and armiktech.com rendered zero
-- products while the inventory was intact the whole time.
--
-- READ ACCESS IS PUBLIC, DELIBERATELY. The storefront is browsed by anonymous
-- visitors who have no Supabase session, so SELECT must be allowed to everyone
-- or the shop is empty for every real customer. This is safe because of what
-- buildStoreCatalog (utils/storefrontCatalog.ts) actually puts in catalog_data:
-- id, name, category, public sell price, images, description, specs, badge and
-- quantity — for in-stock, non-draft, store-visible items only. It deliberately
-- omits buyPrice, profit, vendor, customer details and eBay order ids. Nothing
-- here is private; it is the shop window.
--
-- WRITES ARE OWNER-ONLY. Only the authenticated owner may publish, so a visitor
-- cannot alter prices or inject items.
--
-- user_id is the PRIMARY KEY because both writers call .upsert() without an
-- explicit onConflict, which resolves against the primary key. A surrogate id
-- would silently insert a new row on every publish instead of replacing.

CREATE TABLE IF NOT EXISTS public.storefront_catalog (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    catalog_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.storefront_config (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    config_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.storefront_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_config ENABLE ROW LEVEL SECURITY;

-- Permissive policies are OR'd, so the owner keeps full access through the
-- second policy while everyone else gets read-only through the first.
DROP POLICY IF EXISTS "Anyone can read the storefront catalog" ON public.storefront_catalog;
CREATE POLICY "Anyone can read the storefront catalog"
    ON public.storefront_catalog FOR SELECT
    USING (TRUE);

DROP POLICY IF EXISTS "Owner can publish the storefront catalog" ON public.storefront_catalog;
CREATE POLICY "Owner can publish the storefront catalog"
    ON public.storefront_catalog FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can read the storefront config" ON public.storefront_config;
CREATE POLICY "Anyone can read the storefront config"
    ON public.storefront_config FOR SELECT
    USING (TRUE);

DROP POLICY IF EXISTS "Owner can edit the storefront config" ON public.storefront_config;
CREATE POLICY "Owner can edit the storefront config"
    ON public.storefront_config FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
