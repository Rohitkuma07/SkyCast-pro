# SkyCast Pro — Optional AI backend

The AI Weather Lifestyle Assistant **works with no backend at all** (it answers
from live weather data using the built-in rules engine in `js/ai-engine.js`).

This folder is only needed if you want answers to be written by a large language
model (OpenAI / Groq / OpenRouter / any OpenAI-compatible API). It exists so the
**AI key never touches the browser or GitHub** — the browser calls this proxy,
and the proxy adds the secret key server-side.

```
backend/
├─ api/ai.js                  # Vercel serverless function  → POST /api/ai
├─ netlify/functions/ai.js    # Netlify function            → POST /.netlify/functions/ai
├─ .env.example               # copy to .env (never commit .env)
└─ package.json
```

## Contract

```
POST <your-backend-url>
Content-Type: application/json

{
  "question": "Can I play cricket this evening?",
  "language": "en",              // "en" | "hi"
  "city": "New Delhi",
  "context": { ...real weather data from the browser... }
}

→ 200 { "answer": "...", "model": "gpt-4o-mini" }
```

If the backend is down, returns an error, or is not configured, the frontend
**silently falls back** to the local rules engine — it never breaks.

## 1. Deploy the function

### Vercel
```bash
cd backend
npx vercel            # first run links/creates the project; framework = Other
npx vercel --prod
# → function URL: https://<project>.vercel.app/api/ai
```

### Netlify
```bash
cd backend
npx netlify deploy --prod
# → function URL: https://<site>.netlify.app/.netlify/functions/ai
```

(Any host that can run the handler in `api/ai.js` works the same way.)

## 2. Set environment variables

Set these in the host dashboard (Vercel → Project → Settings → Environment
Variables, or Netlify → Site settings → Environment). See `.env.example`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AI_API_KEY` | ✅ | — | Provider secret. Server-side only. |
| `AI_MODEL` | — | `gpt-4o-mini` | Any OpenAI-compatible chat model. |
| `AI_BASE_URL` | — | `https://api.openai.com/v1` | Groq / OpenRouter / Together / local. |
| `ALLOWED_ORIGINS` | — | `https://rohitkuma07.github.io` | Comma-separated allowed browser origins. |

## 3. Point the frontend at it

You have two options (no key is ever placed in the frontend):

**Option A — edit the config in `js/ai-assistant.js`:**
```js
var DEFAULT_CONFIG = {
  backendUrl: "https://<project>.vercel.app/api/ai",
  ...
};
```

**Option B — set it at runtime** (e.g. in the browser console) without a rebuild:
```js
window.SKYCAST_AI_CONFIG = { backendUrl: "https://<project>.vercel.app/api/ai" };
// or persist it:
localStorage.setItem("skycast_ai_backend", "https://<project>.vercel.app/api/ai");
```

The chat footer will switch from **“Live-data engine”** to **“AI model + live data”**
once a backend replies successfully. If the call fails, it reverts automatically.

## Security notes

- The AI key lives **only** in the server environment. It is never bundled,
  logged, or returned to the browser.
- `ALLOWED_ORIGINS` restricts which sites may call the function (CORS).
- The handler caps request size, question length, tokens and applies a
  best-effort per-IP rate limit (20 requests / minute / warm instance).
- For production-grade rate limiting, add a shared store (Upstash Redis, etc.).
- The existing OpenWeatherMap key in `js/api.js` is a **client-side key required
  by a static dashboard**. If you want to hide it too, proxy the weather calls
  through the same backend — this is documented as a known limitation in the
  root `README.md`.
