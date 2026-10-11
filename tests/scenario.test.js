/* Extra scenario checks: cold/rainy city carry advice + nodata guard */
"use strict";
const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync("js/ai-engine.js", "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const AI = sandbox.SkyCastAI;

const out = {};

// --- cold rainy city (Leh-like) ---
const store = {
  updatedAt: Date.now(),
  current: {
    name: "Leh", timezone: 19800,
    coord: { lat: 34.15, lon: 77.57 },
    sys: { country: "IN", sunrise: Math.floor(Date.now() / 1000) - 3600 * 4, sunset: Math.floor(Date.now() / 1000) + 3600 * 8 },
    main: { temp: 4, feels_like: 1, humidity: 85, pressure: 1020 },
    wind: { speed: 3.1, deg: 90 },
    clouds: { all: 90 },
    visibility: 4000,
    weather: [{ id: 501, main: "Rain", description: "moderate rain", icon: "10d" }],
    rain: { "1h": 1.5 }, snow: null, dt: Math.floor(Date.now() / 1000),
  },
  env: {
    current: { uv_index: 1 },
    hourly: {
      time: [], temperature_2m: [], apparent_temperature: [], relative_humidity_2m: [],
      precipitation_probability: [], precipitation: [], wind_speed_10m: [], uv_index: [],
      weather_code: [], visibility: [],
    },
  },
  aqi: null,
  forecast: {
    list: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33].map((hh) => ({
      dt: Math.floor(Date.now() / 1000) + hh * 3600,
      main: { temp: 4, feels_like: 1, humidity: 85 },
      weather: [{ id: 501, main: "Rain" }],
      wind: { speed: 3 },
      pop: 0.8, sys: { pod: hh >= 6 && hh < 19 ? "d" : "n" },
    })),
  },
};
const ctx = AI.buildContext(store);
const r = AI.answer("What should I carry today?", ctx, "en");
out.coldRainCarry = { intent: r.intent, items: r.sections[0].items };
out.coldRainAssess = { score: AI.assess(ctx, "en").score };
const wl = AI.warnings(ctx, "en");
out.coldRainWarnings = wl.map((w) => w.key + "@" + w.level);

// --- no data ---
const nodata = AI.answer("what should I wear?", { available: false }, "en");
out.nodata = { intent: nodata.intent, first: nodata.sections[0].items[0] };

console.log(JSON.stringify(out, null, 2));
const fails = [];
if (!/jumper|jacket|warm|wool|sweater/i.test(out.coldRainCarry.items.join(" "))) fails.push("cold city should recommend warm clothing");
if (out.coldRainWarnings.length === 0) fails.push("rainy city should produce a warning");
if (out.nodata.intent !== "nodata") fails.push("nodata guard failed");
if (fails.length) { console.log("FAIL:\n" + fails.join("\n")); process.exit(1); }
console.log("\nSCENARIO CHECKS PASS");