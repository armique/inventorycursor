# DeInventory Pro

Inventory and resale management for German PC parts sellers (Kleinanzeigen, eBay.de, storefront).

## Quick start

```powershell
npm install
cp .env.example .env
# Add VITE_GEMINI_API_KEY (and optionally VITE_GROQ_API_KEY) — see API_KEYS_GUIDE.md
npm run dev
```

Open `http://localhost:5173/panel/dashboard` for the admin panel, or `/` for the public storefront.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `VITE_GEMINI_API_KEY` | Deal Hunter, AI listings, screenshot parse (browser) |
| `GEMINI_API_KEY` | Vercel API routes (`/api/*`) — same key as above on server |
| `VITE_GROQ_API_KEY` | Fast spec fill (optional) |
| Firebase config | Settings → Cloud Sync (or baked-in defaults) |

See [API_KEYS_GUIDE.md](./API_KEYS_GUIDE.md) and [.env.example](./.env.example).

## Deploy

- **Vercel** (recommended for API routes): connect repo, set env vars, deploy.
- **Firebase Hosting**: `npm run deploy` (static build; API routes need Vercel or separate backend).

## Main features

- Inventory with bundles/PCs, Kleinanzeigen + eBay sale capture
- Finanzamt Excel export, invoices, expenses
- Deal Hunter (saved searches, AI sourcing)
- Public storefront (ArmikTech) with inquiries
- Firebase cloud sync + GitHub backup

## Panel routes

| Path | Description |
|------|-------------|
| `/panel/inventory` | Main stock list |
| `/panel/deal-hunter` | Saved KA/eBay searches |
| `/panel/health-check` | API keys & sync status |
| `/panel/competitors` | eBay competitor watch |

## Git hooks (optional)

```powershell
git config core.hooksPath .githooks
```

Auto-pushes after each commit when configured.
