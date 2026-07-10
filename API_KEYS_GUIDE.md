# Free API keys guide – where to get them

Use these in your **`.env`** file (copy from `.env.example`). The app uses the first working provider; add one or more for AI features (parse specs, category suggestions).

---

## 1. Groq (recommended – free, fast)

**Env variable:** `VITE_GROQ_API_KEY`

1. Go to **https://console.groq.com**
2. Sign up / log in (Google or email).
3. Open **API Keys** in the left sidebar (or **https://console.groq.com/keys**).
4. Click **Create API Key**, name it (e.g. `inventory-app`), then **Submit**.
5. Copy the key (starts with `gsk_...`) and paste into `.env`:
   ```env
   VITE_GROQ_API_KEY=gsk_your_key_here
   ```

Free tier is generous; good for category suggestions and spec parsing.

---

## 2. Google Gemini (free tier)

**Env variable:** `VITE_GEMINI_API_KEY`

1. Go to **https://aistudio.google.com/apikey** (Google AI Studio).
2. Sign in with your Google account.
3. Click **Create API key** (choose or create a project if asked).
4. Copy the key and add to `.env`:
   ```env
   VITE_GEMINI_API_KEY=your_key_here
   ```

Free tier has rate limits but is usually enough for light use.

---

## 3. Together AI (free credits for new users)

**Env variable:** `VITE_TOGETHER_API_KEY`

1. Go to **https://api.together.xyz**
2. Sign up / log in.
3. Open **Settings** → **API Keys** (or **https://api.together.xyz/settings/api-keys**).
4. Create a new API key and copy it.
5. Add to `.env`:
   ```env
   VITE_TOGETHER_API_KEY=your_key_here
   ```

New accounts often get free credits.

---

## 4. Mistral AI (free tier)

**Env variable:** `VITE_MISTRAL_API_KEY`

1. Go to **https://console.mistral.ai**
2. Sign up / log in.
3. Open **API Keys** (or **Organization** → **API keys**).
4. Create an API key and copy it.
5. Add to `.env`:
   ```env
   VITE_MISTRAL_API_KEY=your_key_here
   ```

---

## 5. Ollama (free, runs on your PC – no key)

**Env variables:** `VITE_OLLAMA_URL` (and optionally `VITE_OLLAMA_MODEL`)

1. Install **Ollama**: https://ollama.com (Windows/Mac/Linux).
2. Open a terminal and run: `ollama run llama3.2` (or another model) once to download it.
3. In `.env`:
   ```env
   VITE_OLLAMA_URL=http://localhost:11434
   # VITE_OLLAMA_MODEL=llama3.2
   ```

No API key; everything runs locally.

---

## 6. OpenAI (paid – optional)

**Env variable:** `VITE_OPENAI_API_KEY`

1. Go to **https://platform.openai.com**
2. Sign up / log in → **API keys** (https://platform.openai.com/api-keys).
3. Create a key; add to `.env`:
   ```env
   VITE_OPENAI_API_KEY=sk-your_key_here
   ```

Requires a paid account (or temporary free credits if offered).

---

## 7. Anthropic Claude (paid / trial – optional)

**Env variable:** `VITE_ANTHROPIC_API_KEY`

1. Go to **https://console.anthropic.com**
2. Sign up / log in → **API Keys**.
3. Create a key; add to `.env`:
   ```env
   VITE_ANTHROPIC_API_KEY=your_key_here
   ```

---

## 8. Real product photos for the item editor ("Find real photos" button)

Powers the "Find real photos" button in the item editor — searches real product images and lets you set one as the item's default photo. By default it tries providers in order (same fallback pattern as the AI spec-parsing providers): **Google Custom Search → Bing Image Search → eBay → Pixabay → Unsplash → Pexels**, using whichever you've configured. A row of standalone buttons next to "Find real photos" also lets you force one specific provider instead of "Auto" — click it once to switch. You only need to set up one to make the button work; add more for reliability/comparison. All keys are **server-side** (set on Vercel, not your local `.env` — the button calls `/api/images`, which only runs when deployed on Vercel or via `vercel dev`).

**On match accuracy:** Google, Bing, and eBay index real retailer/listing pages, so they're far better at matching an *exact* model number (e.g. "i3-6300" vs "i3-9400F"). Pixabay, Unsplash, and Pexels are general stock-photo libraries matched by loose tags/description, not product catalogs — they can return a similar-looking but wrong item. Good as free, no-setup fallbacks, not as the primary source for precise part photos.

### 8a. Google Custom Search (best match accuracy, but the most setup)

**Env vars:** `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX`

1. **API key**: go to **https://console.cloud.google.com/apis/credentials**, create/select a project, **Create Credentials → API key**. Enable the **Custom Search API** at **https://console.cloud.google.com/apis/library/customsearch.googleapis.com**.
2. **Billing**: this API requires an active billing account linked to the project (free tier is still free, billing is just required to exist). Check/link one at **https://console.cloud.google.com/billing**.
3. **Search Engine ID**: go to **https://programmablesearchengine.google.com/controlpanel/create**.
   - Google has deprecated "Search the entire web" for new engines — it can no longer be enabled. Instead, add specific retailer/tech sites to search under "Sites to search" (e.g. `www.amazon.com/*`, `www.ebay.com/*`, `www.newegg.com/*`, `www.bestbuy.com/*`, `www.mediamarkt.de/*`, `geizhals.de/*`, `www.cyberport.de/*` — add whatever fits your market). Product photos are almost always hosted on sites like these anyway.
   - Turn on **Image search** in its settings.
   - Copy the **Search engine ID** — that's your `cx`.
4. Set both on Vercel, redeploy.

Free tier: 100 searches/day, then billed per 1,000 queries.

### 8b. Bing Image Search (fallback — similar quality, Azure account)

**Env var:** `BING_SEARCH_API_KEY`

1. Go to **https://portal.azure.com**, create a **"Bing Search v7"** resource (search for it in "Create a resource").
2. Once created, open it → **Keys and Endpoint** → copy **Key 1**.
3. Set `BING_SEARCH_API_KEY` on Vercel, redeploy.

Free (F1) tier available with a request-per-second/month cap.

### 8c. eBay Browse API (good accuracy — matches real listing titles, free)

**Env vars:** `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, optional `EBAY_MARKETPLACE_ID` (defaults to `EBAY_DE`)

Searches real eBay listings by keyword and uses their photos — since your item names often match real eBay listing titles closely (you sell there too), this tends to match exact models much better than a stock-photo library.

1. Go to **https://developer.ebay.com/my/keys**, sign up / log in with your eBay account.
2. Click **"Create a keyset"** (choose **Production** keys, not Sandbox).
3. Copy the **App ID (Client ID)** and **Cert ID (Client Secret)** shown there.
4. Set `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` on Vercel. If you mainly want US listings instead of German, also set `EBAY_MARKETPLACE_ID=EBAY_US`.
5. Redeploy.

No app review needed for the Browse API's public search endpoint — works as soon as the keys are set. Free tier: 5,000 calls/day.

### 8d. Pixabay (fallback — free, no billing account needed at all)

**Env var:** `PIXABAY_API_KEY`

1. Go to **https://pixabay.com/api/docs/**, sign up / log in.
2. Your API key is shown right on that docs page once logged in.
3. Set `PIXABAY_API_KEY` on Vercel, redeploy.

No credit card required, generous free tier. Results are more "stock photo" than exact product shots — good as a fallback so the button always returns *something* even if Google/Bing aren't set up.

### 8e. Unsplash (fallback — free, no billing account needed)

**Env var:** `UNSPLASH_ACCESS_KEY`

1. Go to **https://unsplash.com/developers**, sign up / log in, click **"New Application"**.
2. Accept the API terms, give it a name/description.
3. Copy the **Access Key** shown on the app's page.
4. Set `UNSPLASH_ACCESS_KEY` on Vercel, redeploy.

Free tier: 50 requests/hour on the default demo tier (enough for occasional use; apply for production access later if you need more).

### 8f. Pexels (fallback — free, no billing account needed)

**Env var:** `PEXELS_API_KEY`

1. Go to **https://www.pexels.com/api/**, sign up / log in, click **"Get Started"**.
2. Your API key is shown right on the dashboard.
3. Set `PEXELS_API_KEY` on Vercel, redeploy.

Generous free tier (200 requests/hour, 20,000/month), no credit card required.

---

## Quick checklist for `.env`

Copy `.env.example` to `.env` and fill in what you have:

```env
# At least one of these (free options first):
VITE_GROQ_API_KEY=          # https://console.groq.com/keys
VITE_GEMINI_API_KEY=        # https://aistudio.google.com/apikey
VITE_TOGETHER_API_KEY=      # https://api.together.xyz/settings/api-keys
VITE_MISTRAL_API_KEY=       # https://console.mistral.ai

# Optional – local, no key:
# VITE_OLLAMA_URL=http://localhost:11434

# Optional – paid:
# VITE_OPENAI_API_KEY=
# VITE_ANTHROPIC_API_KEY=
```

After editing `.env`, restart the dev server (`npm run dev` or `yarn dev`). Do not commit `.env` or share your keys.
