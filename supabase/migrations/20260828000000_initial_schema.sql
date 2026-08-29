-- ==============================================================================
-- DEINVENTORY -> SUPABASE POSTGRESQL MIGRATION SCHEMA
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USER PROFILES & BUSINESS SETTINGS
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    company_name TEXT DEFAULT '',
    owner_name TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    tax_id TEXT DEFAULT '',
    vat_id TEXT,
    iban TEXT DEFAULT '',
    bic TEXT DEFAULT '',
    bank_name TEXT DEFAULT '',
    tax_mode TEXT DEFAULT 'SmallBusiness',
    
    ebay_postal_code TEXT,
    ebay_paypal_email TEXT,
    ebay_dispatch_time INTEGER DEFAULT 1,
    ebay_return_policy TEXT DEFAULT 'ReturnsAccepted',
    ebay_seller_username TEXT,
    ebay_oauth_token TEXT,
    ebay_oauth_refresh_token TEXT,
    ebay_oauth_expires_at BIGINT,
    ebay_oauth_refresh_expires_at BIGINT,
    kleinanzeigen_profile_url TEXT,
    
    monthly_goal NUMERIC(12, 2) DEFAULT 0.00,
    categories JSONB DEFAULT '{}'::jsonb,
    category_fields JSONB DEFAULT '{}'::jsonb,
    dashboard_prefs JSONB DEFAULT '{}'::jsonb,
    
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. INVENTORY ITEMS
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    buy_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sell_price NUMERIC(12, 2),
    store_price NUMERIC(12, 2),
    profit NUMERIC(12, 2),
    buy_date DATE NOT NULL,
    sell_date DATE,
    container_sold_date DATE,
    category TEXT NOT NULL,
    sub_category TEXT,
    status TEXT NOT NULL CHECK (status IN ('In Stock', 'Sold', 'Ordered', 'In Composition', 'Traded', 'Gifted')),
    comment1 TEXT DEFAULT '',
    comment2 TEXT DEFAULT '',
    image_url TEXT,
    image_urls TEXT[] DEFAULT '{}',
    vendor TEXT,
    
    platform_bought TEXT,
    platform_sold TEXT,
    buy_payment_type TEXT,
    payment_type TEXT,
    
    kleinanzeigen_chat_url TEXT,
    kleinanzeigen_chat_image TEXT,
    kleinanzeigen_buy_chat_url TEXT,
    kleinanzeigen_buy_chat_image TEXT,
    kleinanzeigen_seller_profile_url TEXT,
    kleinanzeigen_listing_url TEXT,
    
    ebay_order_id TEXT,
    ebay_order_line_key TEXT,
    ebay_username TEXT,
    ebay_listing_id TEXT,
    ebay_sku TEXT,
    ebay_offer_id TEXT,
    ebay_condition TEXT,
    shipping_weight_kg NUMERIC(6, 3),
    ebay_shipping_method TEXT,
    ebay_category_id_override TEXT,
    asset_tag TEXT,
    condition_toggles TEXT[] DEFAULT '{}',
    ean TEXT,
    ebay_order_screenshot_url TEXT,
    original_sell_price NUMERIC(12, 2),
    
    has_fee BOOLEAN DEFAULT FALSE,
    fee_amount NUMERIC(12, 2),
    seller_paid_shipping BOOLEAN DEFAULT FALSE,
    seller_shipping_amount NUMERIC(12, 2),
    has_receipt BOOLEAN DEFAULT FALSE,
    receipt_url TEXT,
    invoice_number TEXT,
    uses_differential_vat BOOLEAN DEFAULT FALSE,
    
    is_bundle BOOLEAN DEFAULT FALSE,
    is_pc BOOLEAN DEFAULT FALSE,
    is_draft BOOLEAN DEFAULT FALSE,
    is_defective BOOLEAN DEFAULT FALSE,
    component_ids TEXT[] DEFAULT '{}',
    parent_container_id TEXT REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    split_origin TEXT,
    is_split_remainder BOOLEAN DEFAULT FALSE,
    
    traded_for_ids TEXT[] DEFAULT '{}',
    traded_from_id TEXT,
    cash_on_top NUMERIC(12, 2),
    gift_recipient TEXT,
    gift_relation TEXT,
    
    workflow_stage TEXT,
    print_stage TEXT,
    reserved BOOLEAN DEFAULT FALSE,
    photos_ready BOOLEAN DEFAULT FALSE,
    presence TEXT,
    sale_ready BOOLEAN DEFAULT FALSE,
    listed_via_parent BOOLEAN DEFAULT FALSE,
    listed_on_kleinanzeigen BOOLEAN DEFAULT FALSE,
    listed_on_ebay BOOLEAN DEFAULT FALSE,
    maybe_sold_hint TEXT,
    listing_disappeared_at TIMESTAMPTZ,
    maybe_sold_dismissed_at TIMESTAMPTZ,
    
    market_title TEXT,
    market_description TEXT,
    has_ovp BOOLEAN,
    has_io_shield BOOLEAN,
    ai_description_note TEXT,
    bulk_import_id TEXT,
    
    store_visible BOOLEAN DEFAULT TRUE,
    store_on_sale BOOLEAN DEFAULT FALSE,
    store_sale_price NUMERIC(12, 2),
    store_gallery_urls TEXT[] DEFAULT '{}',
    store_description TEXT,
    store_badge TEXT,
    store_meta_title TEXT,
    store_meta_description TEXT,
    store_description_en TEXT,
    quantity INTEGER DEFAULT 1,
    
    specs JSONB DEFAULT '{}'::jsonb,
    specs_ai_suggested JSONB DEFAULT '{}'::jsonb,
    customer JSONB,
    sale_proceeds JSONB,
    cost_origin JSONB,
    movement_history JSONB DEFAULT '[]'::jsonb,
    ebay_sale_adjustments JSONB DEFAULT '[]'::jsonb,
    ebay_sale_cycles JSONB DEFAULT '[]'::jsonb,
    price_history JSONB DEFAULT '[]'::jsonb,
    proof_attachments JSONB DEFAULT '[]'::jsonb,
    
    is_trash BOOLEAN NOT NULL DEFAULT FALSE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_user_status ON public.inventory_items(user_id, status, is_trash);
CREATE INDEX IF NOT EXISTS idx_inv_user_category ON public.inventory_items(user_id, category);
CREATE INDEX IF NOT EXISTS idx_inv_ebay_order ON public.inventory_items(ebay_order_id) WHERE ebay_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_ebay_listing ON public.inventory_items(ebay_listing_id) WHERE ebay_listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_parent_container ON public.inventory_items(parent_container_id) WHERE parent_container_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_updated_at ON public.inventory_items(updated_at DESC);

-- 3. EXPENSES & RECURRING EXPENSES
CREATE TABLE IF NOT EXISTS public.expenses (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    recurring_expense_id TEXT,
    attachment_url TEXT,
    attachment_name TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON public.expenses(user_id, date DESC);

CREATE TABLE IF NOT EXISTS public.recurring_expenses (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    monthly_amount NUMERIC(12, 2) NOT NULL,
    start_date DATE NOT NULL,
    category TEXT NOT NULL,
    last_generated_date DATE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_user ON public.recurring_expenses(user_id);

-- 4. EBAY ABRECHNUNG & ORDERS CACHE
CREATE TABLE IF NOT EXISTS public.ebay_orders (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    order_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ebay_orders_user ON public.ebay_orders(user_id, order_id);

CREATE TABLE IF NOT EXISTS public.ebay_tx_reports (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    report_name TEXT NOT NULL,
    report_data JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ebay_tx_reports_user ON public.ebay_tx_reports(user_id);

-- 5. PUBLIC STOREFRONT
CREATE TABLE IF NOT EXISTS public.store_inquiries (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    message TEXT NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    contact_name TEXT,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_inquiries_created ON public.store_inquiries(created_at DESC);

CREATE TABLE IF NOT EXISTS public.product_photo_cache (
    query_key TEXT PRIMARY KEY,
    photo_urls TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. ACTION HISTORY & BULK IMPORTS
CREATE TABLE IF NOT EXISTS public.action_history (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    item_id TEXT,
    item_name TEXT,
    details TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_history_user_time ON public.action_history(user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS public.bulk_imports (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    import_data JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. AUTO-UPDATE TIMESTAMP & VERSION TRIGGER
CREATE OR REPLACE FUNCTION public.handle_updated_at_and_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_inventory_updated
    BEFORE UPDATE ON public.inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_and_version();

CREATE OR REPLACE TRIGGER trg_expenses_updated
    BEFORE UPDATE ON public.expenses
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_and_version();

CREATE OR REPLACE TRIGGER trg_recurring_expenses_updated
    BEFORE UPDATE ON public.recurring_expenses
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_and_version();

CREATE OR REPLACE TRIGGER trg_user_profiles_updated
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_and_version();

-- 8. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_tx_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_photo_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view and manage their own profile"
    ON public.user_profiles FOR ALL
    USING (auth.uid() = id);

CREATE POLICY "Users can manage their own inventory items"
    ON public.inventory_items FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own expenses"
    ON public.expenses FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own recurring expenses"
    ON public.recurring_expenses FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own eBay orders"
    ON public.ebay_orders FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own eBay reports"
    ON public.ebay_tx_reports FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own action history"
    ON public.action_history FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own bulk imports"
    ON public.bulk_imports FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Anyone can read visible store items"
    ON public.inventory_items FOR SELECT
    USING (store_visible = TRUE AND is_trash = FALSE);

CREATE POLICY "Anyone can submit a store inquiry"
    ON public.store_inquiries FOR INSERT
    WITH CHECK (TRUE);

CREATE POLICY "Authenticated owners can view and manage store inquiries"
    ON public.store_inquiries FOR ALL
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read and write product photo cache"
    ON public.product_photo_cache FOR ALL
    USING (auth.role() = 'authenticated');
