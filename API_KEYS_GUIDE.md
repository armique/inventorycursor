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
