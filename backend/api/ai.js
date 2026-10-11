/**
 * SkyCast Pro — AI proxy (Vercel serverless function)
 * ---------------------------------------------------------------------------
 * POST /api/ai
 *   body: { question, language, city, context }
 *   resp: { answer }
 *
 * The AI provider key lives ONLY in server environment variables. It is never
 * sent to the browser and never committed to the repository.
 *
 * Environment variables (set them in your host's dashboard, NOT in the repo):
 *   AI_API_KEY       (required)  provider secret key
 *   AI_MODEL         (optional)  default: gpt-4o-mini
 *   AI_BASE_URL      (optional)  default: https://api.openai.com/v1  (OpenAI-compatible)
 *   ALLOWED_ORIGINS  (optional)  comma-separated list, e.g.
 *                                "https://rohitkuma07.github.io,https://your-site.vercel.app"
 *                                default: https://rohitkuma07.github.io
 *
 * Works with any OpenAI-compatible API (OpenAI, Groq, Together, OpenRouter…).
 */

"use strict";

const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_ORIGIN = "https://rohitkuma07.github.io";

// best-effort in-memory rate limit (per warm instance)
const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

function rateLimited(ip) {
  const now = Date.now();
  const rec = HITS.get(ip) || { start: now, count: 0 };
  if (now - rec.start > WINDOW_MS) { rec.start = now; rec.count = 0; }
  rec.count++;
  HITS.set(ip, rec);
  if (HITS.size > 5000) HITS.clear();
  return rec.count > MAX_PER_WINDOW;
}

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGIN)
    .split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin) {
  const list = allowedOrigins();
  const ok = origin && list.indexOf(origin) >= 0;
  return {
    "Access-Control-Allow-Origin": ok ? origin : list[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function buildSystemPrompt(language) {
  const hindi = language === "hi";
  return [
    "You are the SkyCast Pro AI Weather Lifestyle Assistant.",
    "You receive REAL weather data as JSON in the user message under \"weather_context\".",
    "Rules you MUST follow:",
    "1. Base every recommendation on the provided weather_context. Never invent temperatures, rain chance, UV, AQI, wind or warnings.",
    "2. If a value is null or missing, say the information is unavailable. Do not guess.",
    "3. Never claim an activity is safe based on temperature alone — consider rain, wind, humidity, lightning, visibility and air quality together.",
    "4. Treat lightning/thunderstorms, extreme heat, heavy rain/snow and hazardous air quality as safety issues.",
    "5. Give practical, general lifestyle guidance. Do NOT give medical diagnoses; add that guidance is not medical advice.",
    "6. Offer Indian food suggestions when food is relevant (curd, chaas, dal, roti, seasonal fruit, khichdi, soups…).",
    "7. Hydration: give a general range, state that individual needs vary, and avoid a single fixed prescription for everyone.",
    "8. Do not present the SkyCast comfort score as an official safety rating or an official AQI value.",
    "9. Be concise and well structured. Use short sections with a bold heading and bullet points, only the sections that are relevant: Weather summary, Recommended actions, What to carry or wear, Sports & outdoor activity, Food & hydration, Best activity window, Important warnings.",
    "10. If the user writes in Hindi, Hinglish or Devanagari, reply in natural Hindi. Otherwise reply in English.",
    hindi ? "The user's preferred language is Hindi — reply in Hindi." : "",
  ].filter(Boolean).join("\n");
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || "";
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, Object.assign({ "Content-Type": "application/json" }, cors));
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    res.writeHead(429, Object.assign({ "Content-Type": "application/json" }, cors));
    res.end(JSON.stringify({ error: "Too many requests. Please slow down." }));
    return;
  }

  if (!process.env.AI_API_KEY) {
    res.writeHead(500, Object.assign({ "Content-Type": "application/json" }, cors));
    res.end(JSON.stringify({ error: "Server is not configured with AI_API_KEY." }));
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object") {
    res.writeHead(400, Object.assign({ "Content-Type": "application/json" }, cors));
    res.end(JSON.stringify({ error: "Invalid JSON body." }));
    return;
  }

  const question = String(body.question || "").slice(0, 500).trim();
  const language = body.language === "hi" ? "hi" : "en";
  const context = body.context && typeof body.context === "object" ? body.context : {};

  if (!question) {
    res.writeHead(400, Object.assign({ "Content-Type": "application/json" }, cors));
    res.end(JSON.stringify({ error: "Missing question." }));
    return;
  }

  const base = (process.env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.AI_API_KEY,
      },
      body: JSON.stringify({
        model: model,
        temperature: 0.4,
        max_tokens: 650,
        messages: [
          { role: "system", content: buildSystemPrompt(language) },
          {
            role: "user",
            content: "weather_context:\n" + JSON.stringify(context) + "\n\nuser_question: " + question,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      res.writeHead(502, Object.assign({ "Content-Type": "application/json" }, cors));
      res.end(JSON.stringify({ error: "AI provider error", status: r.status, detail: detail.slice(0, 300) }));
      return;
    }

    const data = await r.json();
    const answer = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;

    if (!answer) {
      res.writeHead(502, Object.assign({ "Content-Type": "application/json" }, cors));
      res.end(JSON.stringify({ error: "Empty AI response." }));
      return;
    }

    res.writeHead(200, Object.assign({ "Content-Type": "application/json" }, cors));
    res.end(JSON.stringify({ answer: answer, model: model }));
  } catch (err) {
    clearTimeout(timer);
    res.writeHead(504, Object.assign({ "Content-Type": "application/json" }, cors));
    res.end(JSON.stringify({ error: "AI request failed or timed out." }));
  }
};
