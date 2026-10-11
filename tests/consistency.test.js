/* Consistency tests for the activity-recommendation pipeline.
   Guarantees that scores, labels, explanations and best-time suggestions are
   all produced by ONE shared weather-risk assessment — no "Good" next to
   "not recommended" for the same conditions, no band-vs-rating label clashes,
   and real value-based "why" explanations. "now" is pinned for determinism. */
"use strict";
const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync("js/ai-engine.js", "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "ai-engine.js" });
const AI = sandbox.SkyCastAI;
const I = AI._internal;

const TZ = 19800; // IST (+05:30)
const TODAY = "2026-10-11", TOMORROW = "2026-10-12";
function H(d, h) { return d + "T" + String(h).padStart(2, "0") + ":00"; }
const times = [];
for (let i = 0; i < 24; i++) times.push(H(TODAY, i));
for (let i = 0; i < 24; i++) times.push(H(TOMORROW, i));
const hr = (s) => +s.slice(11, 13);

const defaultSlots = (h) => {
  const hot = h >= 11 && h <= 16;
  return { temp: hot ? 36 : 27, feels: hot ? 40 : 24, hum: 58, wind: 10, pop: hot ? 70 : 10, uv: (h >= 11 && h <= 15) ? 9 : 1, wcode: 0 };
};
function makeCtx(hour, slotFn, cur) {
  slotFn = slotFn || defaultSlots;
  cur = cur || { temp: 34, feels: 42, hum: 70 };
  const store = {
    updatedAt: Date.now(),
    current: {
      name: "Mumbai", timezone: TZ, coord: { lat: 19.07, lon: 72.88 },
      sys: { country: "IN", sunrise: I.localIsoToEpoch(H(TODAY, 6), TZ), sunset: I.localIsoToEpoch(H(TODAY, 18), TZ) },
      main: { temp: cur.temp, feels_like: cur.feels, humidity: cur.hum, pressure: 1006 },
      wind: { speed: 4, deg: 250 }, clouds: { all: 20 }, visibility: 9000,
      weather: [{ id: 800, main: "Clear", description: "clear sky", icon: "01d" }],
      rain: null, snow: null, dt: I.localIsoToEpoch(H(TODAY, hour), TZ),
    },
    env: {
      current: { uv_index: 8 },
      hourly: {
        time: times,
        temperature_2m: times.map((s) => slotFn(hr(s)).temp),
        apparent_temperature: times.map((s) => slotFn(hr(s)).feels),
        relative_humidity_2m: times.map((s) => slotFn(hr(s)).hum),
        precipitation_probability: times.map((s) => slotFn(hr(s)).pop),
        precipitation: times.map(() => 0),
        wind_speed_10m: times.map((s) => slotFn(hr(s)).wind),
        uv_index: times.map((s) => slotFn(hr(s)).uv),
        weather_code: times.map((s) => slotFn(hr(s)).wcode),
        visibility: times.map(() => 10000),
      },
    },
    aqi: { list: [{ main: { aqi: 2 }, components: { pm2_5: 20 } }] },
    forecast: { list: [] },
  };
  const ctx = AI.buildContext(store);
  ctx.localNow = { epoch: I.localIsoToEpoch(H(TODAY, hour), TZ), hour: hour, min: 0, date: TODAY, day: 0 };
  return ctx;
}
const sec = (r, key) => (r.sections.find((s) => s.key === key) || { items: [] }).items.join(" ");
const BAND_WORDS = ["Excellent", "Fair", "Very poor", "Poor"];
const RATING_RE = /\b(Great time|Good|Caution|Avoid outdoors)\b \(\d+\/100\)/;

const fails = [];
const cA14 = makeCtx(14); // hot midday (now), cool evening (5-8 PM)
const cA18 = makeCtx(18);
const cD = makeCtx(14, (h) => ({ temp: 32, feels: 35, hum: 88, wind: 8, pop: 40, uv: 6, wcode: 0 }), { temp: 32, feels: 35, hum: 88 });
const cC = makeCtx(14, (h) => ({ temp: 38, feels: 44, hum: 60, wind: 4, pop: 30, uv: 9, wcode: 0 }), { temp: 38, feels: 44, hum: 60 });
const cE = makeCtx(14, (h) => (h === 18 ? { temp: 27, feels: 24, hum: 58, wind: 10, pop: 90, uv: 1, wcode: 95 } : defaultSlots(h)));

/* ---------- 1) same risk assessment for verdicts and best-time slots ---------- */
["walking", "running", "cycling", "cricket", "football", "badminton", "tennis",
  "basketball", "yoga", "swimming", "picnic", "hiking", "gym"].forEach((k) => {
  const bw = AI.bestWindow(cA14, "en", k);
  if (!bw) return;
  const ev = AI.activityAdvice(cA14, k, "en", bw.slot, true);
  if (ev.score !== bw.score)
    fails.push(k + ": bestWindow score " + bw.score + " != verdict score " + ev.score + " for the same slot");
  if (ev.ratingKey !== bw.rating.key)
    fails.push(k + ": bestWindow rating " + bw.rating.key + " != verdict rating " + ev.ratingKey);
  // the label shown next to the suggested time must come from the same scale
  if (ev.ratingKey !== (I.rateOf(bw.score).key))
    fails.push(k + ": displayed rating inconsistent with the numeric score");
});

/* ---------- 2) hot midday: cricket is avoid; cooler evening is a Great window ---------- */
const q1 = AI.answer("Can I play cricket now?", cA14, "en");
const s1 = sec(q1, "sports"), w1 = sec(q1, "window");
if (!/Avoid outdoors/.test(s1)) fails.push("hot midday cricket should be 'Avoid outdoors'");
if (!/Great time/.test(w1)) fails.push("cool evening should be offered as a Great-time window");
if (!RATING_RE.test(w1)) fails.push("best-window label must carry the rating scale + score: " + w1);
if (BAND_WORDS.some((b) => w1.indexOf(b) >= 0)) fails.push("best-window must not use band vocabulary: " + w1);
if (/Best window/.test(w1) && !/Great time|Good/.test(w1)) fails.push("'Best window' header must only pair with Good/Great grades");

/* ---------- 3) hot conditions: proportionate precautions + no safety claim ---------- */
if (!/Heat care/.test(s1)) fails.push("hot conditions should include proportionate heat care");
if (!/not a safety or medical clearance/.test(s1)) fails.push("the safety disclaimer must stay");

/* ---------- 4) "why" questions explain the real weather-driven reasons ---------- */
const q2 = AI.answer("Why can't I play cricket now?", cA14, "en");
const t2 = sec(q2, "sports");
if (!/Why:/.test(t2)) fails.push("a 'why' question should get an explicit 'Why:' explanation");
if (!/feels-like 42/.test(t2)) fails.push("why should cite the actual feels-like value (42°C)");
if (/feels-like 42.*feels-like 42/.test(t2)) fails.push("why must not repeat the same factor twice: " + t2);
if (!/humidity 70%/.test(t2)) fails.push("why should cite the actual humidity (70%)");
if (!/UV 8/.test(t2)) fails.push("why should cite the actual UV (8) when available");
if (/Great time/.test(s1) && /Avoid outdoors/.test(s1)) fails.push("same section must not claim Good and Avoid");

/* ---------- 5) Hindi "why" ---------- */
const qhi = AI.answer("मैं अभी क्रिकेट क्यों नहीं खेल सकता?", cA14, "hi");
const thi = qhi.sections.map((s) => s.items.join(" ")).join(" ");
if (!/वजह/.test(thi)) fails.push("Hindi why should include 'वजह'");
if (!/[\u0900-\u097F]/.test(thi)) fails.push("Hindi answer should be in Devanagari");

/* ---------- 6) cool evening verdict and its window agree (no contradiction) ---------- */
const q6 = AI.answer("Can I play cricket this evening?", cA18, "en");
if (!/Great time/.test(sec(q6, "sports"))) fails.push("cool evening cricket must be Great time: " + sec(q6, "sports"));
if (/Avoid outdoors/.test(sec(q6, "sports"))) fails.push("cool evening cricket must not be avoid");
if (!RATING_RE.test(sec(q6, "window"))) fails.push("window label must use rating scale at c18: " + sec(q6, "window"));

/* ---------- 7) hard gate: all-day extreme heat caps the best window ---------- */
const bwc = AI.bestWindow(cC, "en", "cricket");
if (!bwc) fails.push("all-day-hot context should still have a best window");
else if (bwc.score > 35) fails.push("all-day heat must cap cricket best window at 35, got " + bwc.score);
else if (bwc.rating.key !== "avoid") fails.push("all-day heat best window must be 'avoid', got " + bwc.rating.key);

/* ---------- 8) thunder slot is never recommended as the best window ---------- */
const bwe = AI.bestWindow(cE, "en", "cricket");
if (!bwe) fails.push("thunder-18 context should have a best window");
else if (bwe.slot && bwe.slot.hour === 18) fails.push("a thunderstorm slot must never win the best window");
else if (bwe.score < 80) fails.push("the non-thunder cool slot should score high, got " + bwe.score);

/* ---------- 9) planner windows use the same rating labels, not band labels ---------- */
const pl = AI.planner(cA14, "en");
if (!pl.windows.length) fails.push("planner should produce windows");
pl.windows.forEach((w) => {
  if (BAND_WORDS.some((b) => w.band.indexOf(b) >= 0)) fails.push("planner windows must use rating labels, got '" + w.band + "'");
  if (!/(Great time|Good|Caution|Avoid outdoors)/.test(w.band)) fails.push("planner window label not on the rating scale: '" + w.band + "'");
});
if (!pl.windows.some((w) => w.band === "Great time" || w.band === "Good"))
  fails.push("cool-evening planner windows should rate at least Good");

/* ---------- 10) when only a 'caution' window exists, phrase it as 'Better time' ---------- */
const qd = AI.answer("Can I run now?", cD, "en");
if (!/Better time/.test(sec(qd, "window"))) fails.push("caution-only situation should be phrased 'Better time', got: " + sec(qd, "window"));
if (!/Caution/.test(sec(qd, "sports"))) fails.push("uniform hot-humid running should be 'Caution'");

/* ---------- 11) timezone/past handling stays intact ---------- */
const c18 = makeCtx(18);
const qp = AI.answer("Can I play cricket in the morning?", c18, "en");
if (!/passed/i.test(sec(qp, "sports"))) fails.push("past morning must still say the time has passed");
if (!/Next suitable time/i.test(sec(qp, "sports"))) fails.push("past request must still suggest the next suitable time");

if (fails.length) { console.log("FAILURES:\n" + fails.join("\n")); process.exit(1); }
console.log("ALL CONSISTENCY TESTS PASS");