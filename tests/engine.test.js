/* End-to-end test for js/ai-engine.js (run with node, no browser needed) */
"use strict";
const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("js/ai-engine.js", "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "ai-engine.js" });
const AI = sandbox.SkyCastAI;

const results = {};

function H(d, hh) { return d + "T" + String(hh).padStart(2, "0") + ":00"; }
const today = "2026-10-11", tomorrow = "2026-10-12";
const hourTimes = [];
for (let i = 0; i < 24; i++) hourTimes.push(H(today, i));
for (let i = 0; i < 8; i++) hourTimes.push(H(tomorrow, i + 6));
const hourPop = hourTimes.map((h) => (h.startsWith(today) && +h.slice(11, 13) >= 17 && +h.slice(11, 13) <= 20 ? 70 : 20));
const hourUv = hourTimes.map((h) => (+h.slice(11, 13) >= 11 && +h.slice(11, 13) <= 15 ? 8 : 2));
const hourTemp = hourTimes.map((h) => (+h.slice(11, 13) < 6 ? 26 : +h.slice(11, 13) < 12 ? 29 : 33));
const hourFeels = hourTemp.map((t) => t + 3);
const hourHum = hourTimes.map((h) => (+h.slice(11, 13) >= 11 && +h.slice(11, 13) <= 16 ? 72 : 60));
const hourWind = hourTimes.map((h) => (+h.slice(11, 13) >= 15 && +h.slice(11, 13) <= 18 ? 28 : 12));

const store = {
  updatedAt: Date.now(),
  current: {
    name: "Mumbai", timezone: 19800,
    coord: { lat: 19.07, lon: 72.88 },
    sys: { country: "IN", sunrise: Math.floor(Date.now() / 1000) - 3600 * 5, sunset: Math.floor(Date.now() / 1000) + 3600 * 5 },
    main: { temp: 32, feels_like: 38, humidity: 78, pressure: 1008 },
    wind: { speed: 5.2, gust: 8.1, deg: 250 },
    clouds: { all: 40 },
    visibility: 8000,
    weather: [{ id: 801, main: "Clouds", description: "few clouds", icon: "02d" }],
    rain: null, snow: null, dt: Math.floor(Date.now() / 1000),
  },
  env: {
    current: { uv_index: 8.2 },
    hourly: {
      time: hourTimes, temperature_2m: hourTemp, apparent_temperature: hourFeels,
      relative_humidity_2m: hourHum, precipitation_probability: hourPop,
      precipitation: hourPop.map((p) => (p > 50 ? 3.2 : 0)), wind_speed_10m: hourWind,
      uv_index: hourUv, weather_code: hourPop.map((p) => (p > 50 ? 61 : 2)),
      visibility: hourTimes.map(() => 9000),
    },
  },
  aqi: { list: [{ main: { aqi: 3 }, components: { pm2_5: 42.1, pm10: 88.4, co: 0.6, no2: 18, o3: 60, so2: 8 } }] },
  forecast: {
    list: [0, 3, 6, 9, 12, 15, 18, 21].map((hh) => ({
      dt: Math.floor(Date.now() / 1000) + hh * 3600,
      main: { temp: 32, feels_like: 37, humidity: 76 },
      weather: [{ id: 801, main: "Clouds" }],
      wind: { speed: 5 },
      pop: 0.25, sys: { pod: hh >= 6 && hh < 19 ? "d" : "n" },
    })),
  },
};

const ctx = AI.buildContext(store);
results.ctx = { available: ctx.available, city: ctx.city, uv: ctx.uv, timelineLen: ctx.timeline.length, days: ctx.days.length };

const r1 = AI.answer("What should I carry today?", ctx, "en");
results.q1 = { intent: r1.intent, lang: r1.lang, sectionTitles: r1.sections.map((s) => s.title), sample: r1.sections.map((s) => s.items.slice(0, 2)) };

const r2 = AI.answer("क्या मैं आज शाम क्रिकेट खेल सकता हूँ?", ctx, "hi");
results.q2 = {
  intent: r2.intent, lang: r2.lang,
  sectionTitles: r2.sections.map((s) => s.title),
  hasDevnagari: /[\u0900-\u097F]/.test(JSON.stringify(r2.sections)),
  sample: r2.sections.map((s) => s.items.slice(0, 3)),
};

const r3 = AI.answer("Give me today's daily briefing", ctx, "en");
results.q3 = { intent: r3.intent, sectionTitles: r3.sections.map((s) => s.title) };

const r4 = AI.answer("weather today", ctx, "en");
results.q4 = { intent: r4.intent, firstTitle: r4.sections[0] && r4.sections[0].title };

const r5 = AI.answer("is it hot", ctx, "en");
results.q5 = { intent: r5.intent };

const r6 = AI.answer("how is the air quality", ctx, "en");
results.q6 = { intent: r6.intent };

results.detectLang = {
  hindi: AI.detectLang("क्या मैं आज शाम क्रिकेट खेल सकता हूँ?", "auto"),
  hinglish: AI.detectLang("aaj kya carry karu?", "auto"),
  english: AI.detectLang("What should I wear?", "auto"),
};

const bw = AI.bestWindow(ctx, "hi", "cricket");
results.hindiWindowLabel = bw ? bw.label : null;
results.labelHasAprahan = bw ? /अपराह्न/.test(bw.label) : false;

const c = AI.assess(ctx, "en");
results.comfort = { score: c.score, band: c.band.label, factors: c.factors.length };

const p = AI.planner(ctx, "hi");
results.planner = { periods: p.periods.map((x) => x.name), checklist: p.checklist.length, windows: p.windows.map((w) => w.activity + ": " + w.label) };

console.log(JSON.stringify(results, null, 2));

// assertions
const fails = [];
if (r1.intent !== "carry") fails.push("q1 expected carry, got " + r1.intent);
if (r2.intent !== "activity") fails.push("q2 expected activity, got " + r2.intent);
if (!results.q2.hasDevnagari) fails.push("q2 should be Hindi");
if (r3.intent !== "plan") fails.push("q3 expected plan, got " + r3.intent);
if (r4.intent !== "summary") fails.push("q4 expected summary, got " + r4.intent);
if (r5.intent !== "heat") fails.push("q5 expected heat, got " + r5.intent);
if (bw && /अपराह्न/.test(bw.label)) fails.push("hindi window label still has अपराह्न: " + bw.label);
if (fails.length) { console.log("FAILURES:\n" + fails.join("\n")); process.exit(1); }
console.log("\nALL ENGINE TESTS PASS");