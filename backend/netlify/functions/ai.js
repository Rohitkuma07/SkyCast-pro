/**
 * SkyCast Pro — AI proxy (Netlify Function)
 * ---------------------------------------------------------------------------
 * Endpoint: /.netlify/functions/ai
 * Same contract as backend/api/ai.js: POST { question, language, city, context }
 *
 * Environment variables (Netlify dashboard → Site settings → Environment):
 *   AI_API_KEY, AI_MODEL, AI_BASE_URL, ALLOWED_ORIGINS
 */

"use strict";

const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_ORIGIN = "https://rohitkuma07.github.io";

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
  return (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGIN).split(",").map((s) => s.trim()).filter(Boolean);
}

function buildSystemPrompt(language) {
  const hindi = language === "hi";
  return [
    "You are the SkyCast Pro AI Weather Lifestyle Assistant.",
    "You receive REAL weather data as JSON under \"weather_context\".",
    "Base every recommendation ONLY on that data — never invent temperatures, rain chance, UV, AQI, wind or warnings.",
    "If a value is missing, say it is unavailable. Never claim an activity is safe from temperature alone; weigh rain, wind, humidity, lightning, visibility and air quality.",
    "Treat lightning, extreme heat, heavy rain/snow and hazardous air as safety issues. No medical diagnosis; add that guidance is not medical advice.",
    "Suggest Indian foods when relevant and give a general hydration range noting individual needs vary.",
    "Reply with only the relevant short sections (bold heading + bullets): Weather summary, Recommended actions, What to carry or wear, Sports & outdoor activity, Food & hydration, Best activity window, Important warnings.",
    hindi ? "Reply in natural Hindi." : "Reply in English.",
  ].join("\n");
}

exports.handler = async function (event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || "";
  const list = allowedOrigins();
  const allowed = origin && list.indexOf(origin) >= 0;
  const cors = {
    "Access-Control-Allow-Origin": allowed ? origin : list[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  const json = (code, obj) => ({ statusCode: code, headers: Object.assign({ "Content-Type": "application/json" }, cors), body: JSON.stringify(obj) });

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const ip = (event.headers["x-forwarded-for"] || event.headers["client-ip"] || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) return json(429, { error: "Too many requests. Please slow down." });
  if (!process.env.AI_API_KEY) return json(500, { error: "Server is not configured with AI_API_KEY." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON body." }); }

  const question = String(body.question || "").slice(0, 500).trim();
  const language = body.language === "hi" ? "hi" : "en";
  const context = body.context && typeof body.context === "object" ? body.context : {};
  if (!question) return json(400, { error: "Missing question." });

  const base = (process.env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + process.env.AI_API_KEY },
      body: JSON.stringify({
        model: model,
        temperature: 0.4,
        max_tokens: 650,
        messages: [
          { role: "system", content: buildSystemPrompt(language) },
          { role: "user", content: "weather_context:\n" + JSON.stringify(context) + "\n\nuser_question: " + question },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return json(502, { error: "AI provider error", status: r.status });
    const data = await r.json();
    const answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!answer) return json(502, { error: "Empty AI response." });
    return json(200, { answer: answer, model: model });
  } catch (err) {
    clearTimeout(timer);
    return json(504, { error: "AI request failed or timed out." });
  }
};
