# Sync & backup setup

This app uses **Supabase as the live database**, **Vercel Cron for eBay + off-site backup**, and **one local JSON file when you close the tab**.

---

## 1. Inventory & settings (Supabase)

**What you do in the app**

1. Sign in with Google (Settings → Account).
2. Work normally — every edit syncs to Supabase incrementally.

**Vercel / `.env.local` (client build)**

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key for signed-in reads/writes |

No local inventory mirror is kept in `localStorage` for eBay orders. UI prefs (filters, column widths) may still use small `localStorage` keys.

---

## 2. eBay orders (hourly cron)

**What you do in the app**

1. Settings → **Listings sync** → **Connect eBay** (OAuth once).
2. That saves `ebay_oauth_refresh_token` to `user_profiles` in Supabase.
3. Open **Abrechnung** → **Refresh from cloud** if you need data immediately (otherwise wait up to 1 hour).

**Vercel env (server — Project → Settings → Environment Variables)**

| Variable | Required | Purpose |
|----------|----------|---------|
| `CRON_SECRET` | Yes | Auto-set by Vercel Cron; blocks unauthorized triggers |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Cron reads OAuth token + writes orders |
| `VITE_SUPABASE_URL` or `SUPABASE_URL` | Yes | Supabase project |
| `BACKUP_OWNER_UID` | Yes | Your Supabase auth user UUID |
| `EBAY_CLIENT_ID` | Yes | eBay developer app |
| `EBAY_CLIENT_SECRET` | Yes | eBay developer app |
| `EBAY_SIGNING_PRIVATE_KEY_B64` | Yes (EU) | Finances API fee breakdown |
| `EBAY_SIGNING_KEY_JWE` | Yes (EU) | Finances API fee breakdown |
| `EBAY_SYNC_LOOKBACK_DAYS` | No | Default `30` |
| `EBAY_SYNC_OWNER_UID` | No | Override `BACKUP_OWNER_UID` for eBay only |

**Cron schedule** (`vercel.json`):

- `0 4 * * *` → `/api/ebay?route=order-sync-cron` (daily, 04:00 UTC — Hobby-safe)

**Manual test**

```powershell
npm run ebay:sync-cron
```

Or production (replace secret):

```powershell
curl -H "Authorization: Bearer YOUR_CRON_SECRET" "https://YOUR-DOMAIN.vercel.app/api/ebay?route=order-sync-cron"
```

**Where data lands**

- `ebay_orders` — order cache (buyer, line items, titles, fees)
- `ebay_tx_reports` — rebuilt `api-sync` Abrechnung report
- `user_profiles.dashboard_prefs.ebayOrderCronSync` — last run metadata

---

## 3. Off-site daily backup (GitHub via Vercel)

Separate from eBay — full account snapshot to a **private** GitHub repo.

| Variable | Purpose |
|----------|---------|
| `GITHUB_BACKUP_TOKEN` | PAT with `contents: write` on backup repo |
| `GITHUB_BACKUP_REPO` | `owner/private-repo-name` |
| `BACKUP_OWNER_UID` | Same Supabase user id |

Cron: `0 3 * * *` → `/api/github-oauth?route=daily-backup`

Local mirror (optional): `scripts/pull-github-backup.mjs` → `data/inventory-backup/`

---

## 4. Local backup on app close

When you **close the browser tab** (once per session):

1. Pending Supabase writes are flushed.
2. A JSON file downloads: `deinventory-backup-2026-09-02T134530.json`
3. **Local dev only**: same file is written to `data/session-backups/`

Manual download anytime: Settings → **Download backup** or Inventory → backup action.

**Removed (no longer runs)**

- 5-minute Supabase Storage snapshots
- Browser GitHub auto-push on open/close
- Client-side eBay API pull on every app visit
- `localStorage` eBay order index blob

---

## 5. CSV import (optional)

Seller Hub **CSV import** on Abrechnung still works for historical rows. CSV rows take precedence over API-sync rows for the same order id.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| No new eBay orders | Vercel → Cron logs for `order-sync-cron`; eBay connected in Settings |
| Fee breakdown missing | `EBAY_SIGNING_*` env vars on Vercel |
| Cron 401 | `CRON_SECRET` matches Vercel Cron auth header |
| Stale orders in UI | Abrechnung → refresh from cloud; or wait for next hourly cron |
