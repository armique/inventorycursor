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

## 8. Google Custom Search (real product photos for the item editor)

**Env vars (server-side — set on Vercel, not in the client `.env`):** `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX`

Powers the "Find real photos" button in the item editor (searches real product images and lets you set one as the item's default photo). This uses Google's official, quota-metered Custom Search API — not scraping, which Google blocks and disallows.

1. **Get an API key**: go to **https://console.cloud.google.com/apis/credentials**, create/select a project, click **Create Credentials → API key**. Then enable the **Custom Search API** for that project at **https://console.cloud.google.com/apis/library/customsearch.googleapis.com**.
2. **Create a Programmable Search Engine**: go to **https://programmablesearchengine.google.com/controlpanel/create**.
   - Under "What to search", choose **Search the entire web**.
   - After creating it, open its settings and turn on **Image search**.
   - Copy the **Search engine ID** (this is your `cx` value).
3. Set both on Vercel (**Project → Settings → Environment Variables**), not in your local `.env`:
   ```
   GOOGLE_SEARCH_API_KEY=your_api_key_here
   GOOGLE_SEARCH_CX=your_search_engine_id_here
   ```
4. Redeploy. This only works when deployed on Vercel (or via `vercel dev`) — like the other `/api/*` routes, it doesn't run under a plain local `vite dev` server.

Free tier: 100 searches/day, then billed per 1,000 queries if you enable billing on the Custom Search API.

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
