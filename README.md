# SkyCast Pro — Weather Dashboard + AI Weather Lifestyle Assistant

A real-time weather dashboard (OpenWeatherMap + Leaflet + Chart.js) extended with
an **AI Weather Lifestyle Assistant** that turns live weather, forecast, UV and
air-quality data into practical daily guidance — what to wear, which activities
are safe, what to eat, how to hydrate, and the best time to head outside.

> The assistant is an **extension** of the existing dashboard, not a replacement.
> All original features (search, My Location, voice city search, theme toggle,
> highlights, hourly/7-day forecast, AQI, chart, map) are untouched.

---

## ✨ What the assistant does

| Area | What it gives you |
|---|---|
| **Smart weather advice** | Plain-language summary + what to wear/carry (jacket, umbrella, sunscreen, sunglasses, cap, mask, water bottle…) |
| **Sports & outdoor planner** | Weather-aware rating for cricket, football, badminton, running, cycling, walking, tennis, basketball, yoga, swimming, trekking, picnic — with indoor alternatives and a best time window |
| **Food & hydration** | Weather-appropriate Indian food suggestions and general hydration guidance (no fixed one-size prescription, no medical claims) |
| **Smart daily planner** | Morning/afternoon/evening comparison, activity windows, college/office carry checklist, indoor fallbacks |
| **Interactive chat** | Ask “what should I carry?”, “can I play cricket this evening?”, “will it rain on my commute?” — answered from real data |
| **Outdoor comfort score** | Transparent 0–100 score with every factor and its deduction, plus recommended activities and warnings |
| **Hindi / English / Hinglish** | Auto language detection, manual toggle, optional voice input |
| **Safety first** | Never declares an activity safe from temperature alone — lightning, heat stress, wind, rain/snow, visibility and AQI all factor in |

---

## 🗂️ Files

**Added**
```
js/ai-engine.js          # pure reasoning engine (no network, testable)
js/ai-assistant.js       # UI: cards, chat, voice, optional AI backend glue
css/ai-assistant.css     # assistant styles (matches SkyCast glassmorphism)
backend/api/ai.js        # OPTIONAL secure AI proxy (Vercel)
backend/netlify/functions/ai.js   # OPTIONAL secure AI proxy (Netlify)
backend/.env.example     # server env template
backend/package.json
backend/README.md
```

**Modified**
```
index.html               # AI Assistant section, nav + footer links, CSS/JS tags,
                         # and real ids for the UV/humidity/wind/visibility highlights
js/api.js                # publishes the SAME data it already fetches to window.SkyCastData;
                         # adds optional Open-Meteo UV/hourly enrichment; fixes wind unit
README.md                # this file
```

> Note: stale duplicate files exist at the repo root (`app.js`, `api.js`, `style.css`,
> etc.). They are **not** referenced by `index.html` (which loads `js/` + `css/`).
> They were left untouched rather than deleted. `js/app.js`, `js/theme.js` and
> `css/responsive.css` are empty in the original repo and were also left as-is.

---

## 🚀 Run locally

```bash
python -m http.server 8000
# open http://localhost:8000
```

No build step, no dependencies. Font Awesome, Leaflet, Chart.js and Google Fonts
load from CDNs (as in the original project).

---

## 🔑 Configuration

### Weather (already working)
`js/api.js` uses OpenWeatherMap for current weather, 5-day/3-hour forecast and
air pollution. This is the **same data the dashboard already used** — the
assistant does not add a duplicate weather integration.

### UV + hourly detail
OpenWeatherMap’s free tier has no UV index, so the assistant optionally enriches
with **Open-Meteo** (free, no key): UV, hourly rain probability, apparent
temperature, humidity, wind, visibility. If it fails, UV/hourly detail is simply
shown as unavailable and everything else keeps working. A 10-minute cache is
applied per rounded location.

### Optional AI model (backend)
By default the assistant answers using the **local rules engine** over live data
— nothing to configure. To have a large language model write the answers instead,
deploy the proxy in [`backend/`](backend/README.md) and set:

```js
window.SKYCAST_AI_CONFIG = { backendUrl: "https://<your-app>/api/ai" };
```

The AI key stays **server-side** in environment variables. If the backend is
missing or fails, the assistant falls back automatically. See
[`backend/README.md`](backend/README.md).

---

## 🔐 Security

- **AI keys are never in the frontend.** The browser only talks to your proxy;
  the proxy adds the key from `process.env`.
- The proxy restricts `ALLOWED_ORIGINS`, caps input size/tokens and applies a
  best-effort per-IP rate limit.
- **Known limitation:** the OpenWeatherMap key in `js/api.js` is exposed client-side.
  This is inherent to a static dashboard and was already the case before this
  change. To hide it, proxy the weather calls through the same backend (route
  not included by default) — the assistant is designed to keep working either way.

---

## 🧪 Testing

1. **Serve and open** the page (`python -m http.server 8000`).
   The assistant auto-loads a default/last city so the card is populated.
2. **Check the comfort card** shows a score, an interpretation, per-factor
   deductions and the “not a safety rating” disclaimer.
3. **Search another city** in the top bar → the assistant refreshes automatically.
   Use a very hot city (e.g. `Kuwait City`), a rainy one (e.g. `Kochi` in monsoon),
   and a cold one (e.g. `Leh`) to see different advice.
4. **Chat** — try the suggested questions, and try Hindi:
   `आज क्या पहनूँ?`, `क्या मैं आज शाम क्रिकेट खेल सकता हूँ?`, `पानी कितना पीना चाहिए?`
5. **Toggle language** (Auto / English / हिंदी) — cards and chat re-render.
6. **Voice** — click the mic (Chrome/Edge). Works with `en-IN` / `hi-IN`.
7. **Failure handling** — search an invalid city; the assistant shows its own
   error/empty state without breaking the dashboard.
8. **Responsive** — resize to mobile/tablet widths; cards stack, chat stays usable.
9. **Theme** — toggle the moon/sun button; the assistant supports light mode.

### Offline / automated tests (no browser needed)

The reasoning engine is pure JavaScript, so it can be exercised headlessly:

```bash
# syntax + engine behaviour (needs Node.js only)
node tests/engine.test.js        # or: node --check js/ai-engine.js js/api.js
node tests/scenario.test.js      # cold/rainy city + no-data guard

# intent/routing mirror (needs Python only)
python tests/intent.test.py      # set PYTHONIOENCODING=utf-8 on Windows
```

`tests/engine.test.js` / `tests/scenario.test.js` load the real `js/ai-engine.js`,
build a context from a fake weather store and assert the routing fixes, Hindi
output and climate-adapted advice; they exit non-zero on any failure. Run them
from the repository root (they read `js/ai-engine.js`).

---

## ⚠️ Limitations & honesty notes

- Recommendations are **lifestyle guidance, not medical or safety certification**,
  and the comfort score is **not** an official rating or an official AQI value.
- Official government weather alerts are **not available** from the free data
  sources used; the UI says so and points you to your local meteorological dept.
- Air quality uses OpenWeatherMap’s **1–5 indicator** (not a national AQI scale).
- If UV/forecast data is unavailable, the assistant says so instead of guessing.
- The best-window search uses the Open-Meteo hourly timeline when available and
  falls back to the 3-hour OpenWeatherMap forecast otherwise.

## 📦 Deploying

The dashboard is a static site → push to `main` and GitHub Pages serves it as
before. The optional AI proxy deploys separately (Vercel/Netlify/Cloudflare) and
is configured via `window.SKYCAST_AI_CONFIG.backendUrl`.

---

© 2026 SkyCast Pro · AI Weather Lifestyle Assistant
