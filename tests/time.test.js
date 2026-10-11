/* Time-awareness tests for js/ai-engine.js (run with node, no browser needed).
   "now" is pinned to a chosen city-local hour so the results are deterministic. */
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
const hot = (h) => h >= 11 && h <= 16; // harsh midday, pleasant evenings/nights
const temp = times.map((s) => (hot(hr(s)) ? 36 : 27));
const feels = times.map((s) => (hot(hr(s)) ? 40 : 24));
const hum = times.map(() => 58);
const wind = times.map(() => 10);
const pop = times.map((s) => (hot(hr(s)) ? 70 : 10));
const uv = times.map((s) => (hr(s) >= 11 && hr(s) <= 15 ? 9 : 1));
const wcode = times.map(() => 0);
const vis = times.map(() => 10000);

function makeCtx(hour) {
  const store = {
    updatedAt: Date.now(),
    current: {
      name: "Mumbai", timezone: TZ, coord: { lat: 19.07, lon: 72.88 },
      sys: { country: "IN", sunrise: I.localIsoToEpoch(H(TODAY, 6), TZ), sunset: I.localIsoToEpoch(H(TODAY, 18), TZ) },
      main: { temp: 34, feels_like: 42, humidity: 70, pressure: 1006 },
      wind: { speed: 4, deg: 250 }, clouds: { all: 20 }, visibility: 9000,
      weather: [{ id: 800, main: "Clear", description: "clear sky", icon: "01d" }],
      rain: null, snow: null, dt: I.localIsoToEpoch(H(TODAY, hour), TZ),
    },
    env: {
      current: { uv_index: 8 },
      hourly: {
        time: times, temperature_2m: temp, apparent_temperature: feels, relative_humidity_2m: hum,
        precipitation_probability: pop, precipitation: times.map(() => 0), wind_speed_10m: wind,
        uv_index: uv, weather_code: wcode, visibility: vis,
      },
    },
    aqi: { list: [{ main: { aqi: 2 }, components: { pm2_5: 20 } }] },
    forecast: { list: [] },
  };
  const ctx = AI.buildContext(store);
  ctx.localNow = { epoch: I.localIsoToEpoch(H(TODAY, hour), TZ), hour: hour, min: 0, date: TODAY, day: 0 };
  return ctx;
}

const join = (r) => r.sections.map((s) => s.items.join(" ")).join(" ");
const out = {};
const c18 = makeCtx(18);

// 1) requested period already passed today
const r1 = AI.answer("Can I play cricket in the morning?", c18, "en");
out.pastMorning = { intent: r1.intent, text: join(r1) };

// 2) "now" must use current conditions, not a fixed afternoon slot
const rNow = AI.answer("Can I play cricket now?", makeCtx(18), "en");
out.now = join(rNow);

// 3) future period today
const rEve = AI.answer("Can I play cricket this evening?", makeCtx(18), "en");
out.evening = join(rEve);

// 4) explicit hour already passed
const r4 = AI.answer("Can I play cricket at 4 pm?", makeCtx(18), "en");
out.at4pm = join(r4);

// 5) explicit hour still upcoming
const r5 = AI.answer("Can I play cricket at 8 pm?", makeCtx(18), "en");
out.at8pm = join(r5);

// 6) Hindi past
const r6 = AI.answer("क्या मैं आज सुबह क्रिकेट खेल सकता हूँ?", makeCtx(18), "hi");
out.hindiPast = join(r6);

// 7) tomorrow morning is still in the future
const r7 = AI.answer("Can I play cricket tomorrow morning?", makeCtx(18), "en");
out.tomorrowMorning = join(r7);

// 8) best window must ignore past slots (city timezone aware)
const bw = AI.bestWindow(makeCtx(18), "en", "cricket");
out.bestWindowHour = bw ? bw.slot.hour : null;

// 9) parser unit checks
out.detect = {
  at4pm: I.detectWhen("play at 4 pm", c18, "en").hour,
  shaam6: I.detectWhen("शाम 6 बजे", c18, "hi").hour,
  morning: I.detectWhen("in the morning", c18, "en").key,
  now: I.detectWhen("right now", c18, "en").key,
  tonight: I.detectWhen("play tonight", c18, "en").key,
  abhi: I.detectWhen("क्या अभी खेल सकता हूँ", c18, "hi").key,
  tomorrow: I.detectWhen("tomorrow", c18, "en").key,
};

// 10) upcoming rain probability uses future slots, not hours already past
const a18 = makeCtx(18); AI.assess(a18, "en"); out.nextPopAt18 = a18.nextPop;
const a12 = makeCtx(12); AI.assess(a12, "en"); out.nextPopAt12 = a12.nextPop;

// 11) OpenWeatherMap-only fallback (no Open-Meteo): iso-less 3h slots still time-aware
const owm = (function () {
  const list = [];
  [TODAY, TOMORROW].forEach((d) => {
    for (let h = 0; h < 24; h += 3) {
      list.push({
        dt: I.localIsoToEpoch(H(d, h), TZ),
        main: { temp: hot(h) ? 36 : 27, feels_like: hot(h) ? 40 : 24, humidity: 58 },
        weather: [{ id: 800, main: "Clear" }], wind: { speed: 3 }, pop: 0.2,
        sys: { pod: h >= 6 && h < 19 ? "d" : "n" },
      });
    }
  });
  const ctx = AI.buildContext({
    updatedAt: Date.now(),
    current: {
      name: "Mumbai", timezone: TZ, coord: { lat: 19.07, lon: 72.88 }, sys: { country: "IN", sunrise: 0, sunset: 0 },
      main: { temp: 34, feels_like: 42, humidity: 70 }, wind: { speed: 4, deg: 200 }, clouds: { all: 20 },
      visibility: 9000, weather: [{ id: 800, main: "Clear" }], rain: null, snow: null, dt: I.localIsoToEpoch(H(TODAY, 15), TZ),
    },
    env: null, aqi: null, forecast: { list: list },
  });
  ctx.localNow = { epoch: I.localIsoToEpoch(H(TODAY, 15), TZ), hour: 15, min: 0, date: TODAY, day: 0 };
  return ctx;
})();
out.owmEvening = join(AI.answer("Can I play cricket this evening?", owm, "en"));
out.owmMorning = join(AI.answer("Can I play cricket this morning?", owm, "en"));

console.log(JSON.stringify(out, null, 2));

const fails = [];
if (out.pastMorning.intent !== "activity") fails.push("past-morning should be an activity answer");
if (!/passed/i.test(out.pastMorning.text)) fails.push("past morning should say the time has passed");
if (!/Next suitable time/i.test(out.pastMorning.text)) fails.push("past morning should suggest the next time");
if (!/6 PM/.test(out.pastMorning.text)) fails.push("should state the city's current local time (6 PM)");

if (!/current conditions/i.test(out.now)) fails.push("'now' should say it evaluated current conditions");
if (/passed/i.test(out.now)) fails.push("'now' must not claim a time has passed");
if (!/34°C/.test(out.now)) fails.push("'now' should report the current temperature");

if (/passed/i.test(out.evening)) fails.push("future evening must not claim past");
if (!/\d{1,2} PM/.test(out.evening)) fails.push("evening answer should name an evening time");

if (!/passed/i.test(out.at4pm)) fails.push("4 PM at 6 PM local should be treated as passed");
if (/passed/i.test(out.at8pm)) fails.push("8 PM at 6 PM local is upcoming, not passed");
if (!/8 PM/.test(out.at8pm)) fails.push("8 PM request should evaluate a slot near 8 PM");

if (!/बीत चुका/.test(out.hindiPast)) fails.push("Hindi past message missing");
if (!/[\u0900-\u097F]/.test(out.hindiPast)) fails.push("Hindi answer should be in Devanagari");

if (/passed/i.test(out.tomorrowMorning)) fails.push("tomorrow morning should not be 'passed'");
if (!/tomorrow/i.test(out.tomorrowMorning)) fails.push("tomorrow morning should be labelled tomorrow");

if (out.bestWindowHour == null || out.bestWindowHour < 17 || out.bestWindowHour > 20) fails.push("best window must skip past slots (got " + out.bestWindowHour + ")");

if (out.detect.at4pm !== 16) fails.push("'at 4 pm' should parse to 16, got " + out.detect.at4pm);
if (out.detect.shaam6 !== 18) fails.push("'शाम 6 बजे' should parse to 18, got " + out.detect.shaam6);
if (out.detect.morning !== "morning") fails.push("'in the morning' should be morning");
if (out.detect.now !== "now") fails.push("'right now' should be now");
if (out.detect.tonight !== "evening") fails.push("'tonight' should map to evening");
if (out.detect.abhi !== "now") fails.push("'अभी' should map to now");
if (out.detect.tomorrow !== "day") fails.push("'tomorrow' should be a whole-day request");

if (out.nextPopAt18 !== 10) fails.push("nextPop at 18:00 should use 18/19/20 (10%), got " + out.nextPopAt18);
if (out.nextPopAt12 !== 70) fails.push("nextPop at 12:00 should use midday slots (70%), got " + out.nextPopAt12);

if (/passed/i.test(out.owmEvening)) fails.push("OWM-only future evening must not claim past");
if (!/\d{1,2} PM/.test(out.owmEvening)) fails.push("OWM-only evening should name an evening time");
if (!/passed/i.test(out.owmMorning)) fails.push("OWM-only morning at 15:00 should be treated as passed");

if (fails.length) { console.log("FAILURES:\n" + fails.join("\n")); process.exit(1); }
console.log("\nALL TIME TESTS PASS");
