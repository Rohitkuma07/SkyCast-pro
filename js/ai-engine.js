/* ============================================================================
   SkyCast Pro — AI Weather Lifestyle Engine
   ----------------------------------------------------------------------------
   Pure, dependency-free reasoning layer. It turns *real* weather data
   (OpenWeatherMap current + 3-hour forecast + air pollution, plus optional
   Open-Meteo hourly environmental detail) into lifestyle guidance.

   Design goals:
     • No network calls here — this file only reasons over data it is given.
     • No fabricated values. If something is missing it says "unavailable".
     • Transparent scoring: every point deducted from the comfort score is
       shown with the factor that caused it.
     • Bilingual (English + Hindi), including Hinglish input understanding.

   Public surface (window.SkyCastAI):
     buildContext(store)         -> normalised weather context (or {available:false})
     assess(ctx, lang)           -> outdoor comfort score + factors + warnings
     clothing(ctx, lang)         -> [{text}] wear / carry advice
     activities(ctx, lang)       -> [{key,name,rating,tip,indoor,window}]
     activityAdvice(ctx,key,..)  -> single-activity assessment
     food(ctx, lang)             -> {foods:[], hydration:[], tips:[]}
     planner(ctx, lang)          -> {periods, checklist, windows, indoor}
     warnings(ctx, lang)         -> [{level,title,text}]
     briefingSections(ctx,lang)  -> ordered [{key,title,items}] sections
     answer(question, ctx, lang) -> {intent, lang, sections, followups}
     detectLang(text, pref)      -> 'en' | 'hi'
     t(lang, key, vars)          -> localised string
   ============================================================================ */
(function (global) {
  "use strict";

  /* ============================ 1. helpers ================================= */

  const MPS_TO_KMH = 3.6;
  const VERSION = "1.0.0";

  const n = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round = (v, d) => {
    const p = Math.pow(10, d || 0);
    return Math.round(v * p) / p;
  };
  const pickLang = (l) => (l === "hi" ? "hi" : "en");
  const DEG = { N: "N", NE: "NE", E: "E", SE: "SE", S: "S", SW: "SW", W: "W", NW: "NW" };
  function compass(deg) {
    if (deg == null) return "";
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round((deg % 360) / 45) % 8];
  }

  /* --- meteorology formulas (standard, cited in README) --- */
  // NWS heat index (°C in, °C out). Only meaningful for warm/humid air.
  function heatIndexC(tC, rh) {
    if (tC == null || rh == null) return null;
    const T = (tC * 9) / 5 + 32;
    if (T < 80) return null;
    const R = rh;
    let hi =
      -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R -
      6.83783e-3 * T * T - 5.481717e-2 * R * R + 1.22874e-3 * T * T * R +
      8.5282e-4 * T * R * R - 1.99e-6 * T * T * R * R;
    return round((hi - 32) * (5 / 9), 1);
  }
  // Environment Canada wind chill (°C in, km/h in).
  function windChillC(tC, vKmh) {
    if (tC == null || vKmh == null || tC > 10 || vKmh < 4.8) return null;
    const v = Math.pow(vKmh, 0.16);
    return round(13.12 + 0.6215 * tC - 11.37 * v + 0.3965 * tC * v, 1);
  }
  function dewPointC(tC, rh) {
    if (tC == null || rh == null) return null;
    const a = 17.27, b = 237.7;
    const al = Math.log(rh / 100) + (a * tC) / (b + tC);
    return round((b * al) / (a - al), 1);
  }

  /* ============================ 2. i18n =================================== */

  const STR = {
    en: {
      unknown: "Unavailable",
      now: "now", today: "today", tomorrow: "tomorrow",
      morning: "morning", afternoon: "afternoon", evening: "evening", night: "night",
      datanote: "Data unavailable",

      sec_summary: "Weather summary",
      sec_actions: "Recommended actions",
      sec_carry: "What to carry or wear",
      sec_sports: "Sports & outdoor activity",
      sec_food: "Food & hydration",
      sec_window: "Best activity window",
      sec_warnings: "Important warnings",

      band_excellent: "Excellent", band_good: "Good", band_fair: "Fair",
      band_poor: "Poor", band_bad: "Very poor",

      f_feels: "Feels-like temperature", f_humidity: "Humidity", f_wind: "Wind",
      f_precip: "Rain / snow chance", f_uv: "UV index", f_aqi: "Air quality",
      f_visibility: "Visibility", f_severity: "Severe weather",

      rating_great: "Great time", rating_good: "Good", rating_caution: "Caution",
      rating_avoid: "Avoid outdoors",

      comfort_disclaimer:
        "This comfort score is a SkyCast lifestyle indicator based on weather data — it is not an official safety rating, health rating or AQI value.",

      alerts_unavailable:
        "Official government weather alerts are not provided by the configured free data sources. Always check your local meteorological department for official warnings.",

      cond_Clear: "Clear sky", cond_Clouds: "Cloudy", cond_Rain: "Rain",
      cond_Drizzle: "Drizzle", cond_Thunderstorm: "Thunderstorm", cond_Snow: "Snow",
      cond_Mist: "Mist", cond_Fog: "Fog", cond_Haze: "Haze", cond_Smoke: "Smoke",
      cond_Dust: "Dust", cond_Sand: "Sand", cond_Ash: "Volcanic ash",
      cond_Squall: "Squall", cond_Tornado: "Tornado", cond_unknown: "—",

      w_tstorm: "Thunderstorm risk", w_tstorm_t:
        "Lightning is possible in this area. Stop outdoor games and swimming and move to a safe indoor shelter until it clears.",
      w_heavyrain: "Heavy rain", w_heavyrain_t:
        "Heavy rain is in the data. Expect waterlogging on roads; carry a rain jacket and allow extra travel time.",
      w_snow: "Heavy snow", w_snow_t:
        "Snowfall is expected. Wear insulated, waterproof footwear and be careful on slippery paths.",
      w_squall: "Squall / severe wind", w_squall_t:
        "Very strong winds are indicated. Avoid cycling, two-wheelers and open areas; secure loose items.",
      w_freezing: "Freezing rain", w_freezing_t:
        "Freezing rain can make surfaces dangerously slippery. Postpone non-essential travel.",
      w_fog: "Low visibility", w_fog_t:
        "Visibility is poor. Drive slowly with low-beam headlights and avoid high-speed roads.",
      w_heat: "Extreme heat", w_heat_t:
        "Heat stress is high. Avoid strenuous outdoor work between 12 PM and 4 PM, sip water often and watch for dizziness or cramps.",
      w_cold: "Severe cold", w_cold_t:
        "Dangerously low feels-like temperature. Cover exposed skin, limit time outdoors and keep dry.",
      w_uv: "High UV", w_uv_t:
        "UV is high. Use sunscreen (SPF 30+), sunglasses and a cap; seek shade around midday.",
      w_aqi: "Hazardous air", w_aqi_t:
        "Air quality is very poor. Avoid outdoor exercise, keep windows shut and consider a well-fitted mask outdoors.",
      w_wind: "Strong wind", w_wind_t:
        "Strong winds may make cycling and ball games uncomfortable or unsafe. Choose a sheltered spot.",
      w_rain: "Wet weather", w_rain_t:
        "Rain is likely. Outdoor plans may get interrupted — keep an indoor backup ready.",

      aq_1: "Good", aq_2: "Fair", aq_3: "Moderate", aq_4: "Poor", aq_5: "Very poor",
      aq_unknown: "Air quality unavailable",

      src_weather: "Weather", src_env: "UV & hourly detail", src_aqi: "Air quality",
    },
    hi: {
      unknown: "उपलब्ध नहीं",
      now: "अभी", today: "आज", tomorrow: "कल",
      morning: "सुबह", afternoon: "दोपहर", evening: "शाम", night: "रात",
      datanote: "डेटा उपलब्ध नहीं",

      sec_summary: "मौसम सारांश",
      sec_actions: "सुझाए गए कदम",
      sec_carry: "क्या साथ रखें या पहनें",
      sec_sports: "खेल और बाहरी गतिविधि",
      sec_food: "खाना और हाइड्रेशन",
      sec_window: "सबसे अच्छा समय",
      sec_warnings: "महत्वपूर्ण चेतावनी",

      band_excellent: "बेहतरीन", band_good: "अच्छा", band_fair: "ठीक-ठाक",
      band_poor: "खराब", band_bad: "बहुत खराब",

      f_feels: "महसूस होने वाला तापमान", f_humidity: "आर्द्रता (नमी)", f_wind: "हवा",
      f_precip: "बारिश / बर्फ़ की संभावना", f_uv: "यूवी इंडेक्स", f_aqi: "वायु गुणवत्ता",
      f_visibility: "दृश्यता", f_severity: "गंभीर मौसम",

      rating_great: "बहुत अच्छा समय", rating_good: "अच्छा", rating_caution: "सावधानी रखें",
      rating_avoid: "बाहर जाना टालें",

      comfort_disclaimer:
        "यह कम्फ़र्ट स्कोर SkyCast का lifestyle संकेतक है जो मौसम डेटा पर आधारित है — यह आधिकारिक सेफ़्टी रेटिंग, स्वास्थ्य रेटिंग या AQI मान नहीं है।",

      alerts_unavailable:
        "कॉन्फ़िगर किए गए फ्री डेटा स्रोतों से सरकारी आधिकारिक मौसम अलर्ट उपलब्ध नहीं हैं। आधिकारिक चेतावनी के लिए हमेशा अपने स्थानीय मौसम विभाग की जाँच करें।",

      cond_Clear: "साफ़ आसमान", cond_Clouds: "बादल", cond_Rain: "बारिश",
      cond_Drizzle: "फुहार", cond_Thunderstorm: "आंधी-तूफ़ान", cond_Snow: "बर्फ़",
      cond_Mist: "धुंध", cond_Fog: "कोहरा", cond_Haze: "धुंधलापन", cond_Smoke: "धुआँ",
      cond_Dust: "धूल", cond_Sand: "रेत", cond_Ash: "ज्वालामुखी राख",
      cond_Squall: "आंधी", cond_Tornado: "बवंडर", cond_unknown: "—",

      w_tstorm: "आंधी-तूफ़ान का ख़तरा", w_tstorm_t:
        "इस क्षेत्र में बिजली गिर सकती है। बाहरी खेल और तैरना रोकें और मौसम साफ़ होने तक सुरक्षित इनडोर जगह पर जाएँ।",
      w_heavyrain: "भारी बारिश", w_heavyrain_t:
        "भारी बारिश का संकेत है। सड़कों पर पानी भर सकता है; रेन जैकेट रखें और यात्रा के लिए अतिरिक्त समय लें।",
      w_snow: "भारी बर्फ़बारी", w_snow_t:
        "बर्फ़बारी की संभावना है। गरम, वॉटरप्रूफ़ जूते पहनें और फिसलन वाले रास्तों पर सावधान रहें।",
      w_squall: "आंधी / तेज़ हवा", w_squall_t:
        "बहुत तेज़ हवाएँ हैं। साइकिल, दोपहिया और खुले क्षेत्रों से बचें; ढीली चीज़ें सुरक्षित करें।",
      w_freezing: "जमने वाली बारिश", w_freezing_t:
        "फ्रीज़िंग रेन से सतहें ख़तरनाक रूप से फिसलन भरी हो सकती हैं। ज़रूरी न हो तो यात्रा टालें।",
      w_fog: "कम दृश्यता", w_fog_t:
        "दृश्यता कम है। धीमे चलाएँ, लो-बीम हेडलाइट जलाएँ और तेज़ रफ़्तार वाली सड़कों से बचें।",
      w_heat: "अत्यधिक गर्मी", w_heat_t:
        "हीट स्ट्रेस ज़्यादा है। दोपहर 12 से 4 बजे तक भारी बाहरी काम से बचें, बार-बार पानी पिएँ और चक्कर/ऐंठन पर ध्यान दें।",
      w_cold: "कड़ाके की ठंड", w_cold_t:
        "महसूस होने वाला तापमान बहुत कम है। खुली त्वचा ढकें, बाहर कम समय रहें और सूखे रहें।",
      w_uv: "तेज़ यूवी", w_uv_t:
        "यूवी ज़्यादा है। सनस्क्रीन (SPF 30+), धूप का चश्मा और कैप इस्तेमाल करें; दोपहर में छाया में रहें।",
      w_aqi: "ख़तरनाक हवा", w_aqi_t:
        "वायु गुणवत्ता बहुत खराब है। बाहर व्यायाम न करें, खिड़कियाँ बंद रखें और बाहर अच्छी मास्क पहनने पर विचार करें।",
      w_wind: "तेज़ हवा", w_wind_t:
        "तेज़ हवाएँ साइकिल चलाना और गेंद के खेल असुविधाजनक या असुरक्षित बना सकती हैं। शरणयुक्त जगह चुनें।",
      w_rain: "बरसात", w_rain_t:
        "बारिश की संभावना है। बाहरी योजनाएँ बाधित हो सकती हैं — इनडोर विकल्प तैयार रखें।",

      aq_1: "अच्छी", aq_2: "ठीक", aq_3: "मध्यम", aq_4: "खराब", aq_5: "बहुत खराब",
      aq_unknown: "वायु गुणवत्ता उपलब्ध नहीं",

      src_weather: "मौसम", src_env: "यूवी और हर घंटे का डेटा", src_aqi: "वायु गुणवत्ता",
    },
  };

  function t(lang, key, vars) {
    const L = pickLang(lang);
    let s = (STR[L] && STR[L][key] != null && STR[L][key]) || (STR.en[key] != null ? STR.en[key] : key);
    if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : ""));
    return s;
  }

  /* ======================= 3. condition classification ==================== */

  function classify(id, main) {
    const m = main || "";
    let kind = "none", severe = false;
    id = n(id);
    if (id != null) {
      if (id >= 200 && id < 300) { kind = "thunder"; severe = true; }
      else if (id >= 300 && id < 400) kind = "drizzle";
      else if (id === 511) { kind = "freezing"; severe = true; }
      else if (id >= 500 && id < 600) kind = "rain";
      else if (id >= 600 && id < 700) kind = "snow";
      else if (id >= 700 && id < 800) kind = "atmosphere";
      else if (id === 771) { kind = "squall"; severe = true; }
      else if (id === 781) { kind = "tornado"; severe = true; }
      else if (id >= 800 && id <= 804) kind = "clouds";
    } else if (m) {
      const ml = m.toLowerCase();
      if (ml.indexOf("thunder") >= 0) { kind = "thunder"; severe = true; }
      else if (ml.indexOf("drizzle") >= 0) kind = "drizzle";
      else if (ml.indexOf("rain") >= 0) kind = "rain";
      else if (ml.indexOf("snow") >= 0) kind = "snow";
      else if (ml.indexOf("cloud") >= 0) kind = "clouds";
      else if (ml.indexOf("clear") >= 0) kind = "clear";
    }
    // precipitation severity (shared by current + hourly)
    let sev = "none";
    if (id != null) {
      if (id === 500) sev = "light";
      else if (id === 501) sev = "moderate";
      else if (id === 502 || id === 503 || id === 522) sev = "heavy";
      else if (id === 504 || id === 531) sev = "extreme";
      else if (id >= 200 && id < 300) sev = id >= 232 ? "heavy" : "moderate";
      else if (id >= 600 && id < 700) sev = id >= 602 ? "heavy" : "moderate";
      else if (id >= 300 && id < 400) sev = "light";
      else if (id === 511) sev = "heavy";
    }
    const precip = (kind === "rain" || kind === "drizzle" || kind === "snow" ||
      kind === "thunder" || kind === "freezing") ? (kind === "snow" ? "snow" : "rain") : "none";
    return { kind: kind, precip: precip, severity: sev, severe: severe };
  }

  function wmoInfo(code) {
    // Open-Meteo WMO weather codes -> our classification
    const c = n(code);
    if (c == null) return classify(null, "");
    if (c >= 95) return { kind: "thunder", precip: "rain", severity: "heavy", severe: true };
    if (c >= 80 && c <= 82) return { kind: "rain", precip: "rain", severity: "moderate", severe: false };
    if (c >= 71 && c <= 77) return { kind: "snow", precip: "snow", severity: "moderate", severe: false };
    if (c >= 85 && c <= 86) return { kind: "snow", precip: "snow", severity: "heavy", severe: false };
    if (c >= 61 && c <= 67) return { kind: "rain", precip: "rain", severity: c >= 65 ? "heavy" : "moderate", severe: false };
    if (c >= 51 && c <= 57) return { kind: "drizzle", precip: "rain", severity: "light", severe: false };
    if (c === 45 || c === 48) return { kind: "atmosphere", precip: "none", severity: "none", severe: false };
    if (c >= 1 && c <= 3) return { kind: "clouds", precip: "none", severity: "none", severe: false };
    if (c === 0) return { kind: "clear", precip: "none", severity: "none", severe: false };
    return { kind: "none", precip: "none", severity: "none", severe: false };
  }

  function condLabel(lang, main, id) {
    const map = {
      Clear: "cond_Clear", Clouds: "cond_Clouds", Rain: "cond_Rain", Drizzle: "cond_Drizzle",
      Thunderstorm: "cond_Thunderstorm", Snow: "cond_Snow", Mist: "cond_Mist", Fog: "cond_Fog",
      Haze: "cond_Haze", Smoke: "cond_Smoke", Dust: "cond_Dust", Sand: "cond_Sand",
      Ash: "cond_Ash", Squall: "cond_Squall", Tornado: "cond_Tornado",
    };
    if (main && map[main]) return t(lang, map[main]);
    const cls = classify(id, main);
    const byKind = {
      thunder: "cond_Thunderstorm", rain: "cond_Rain", drizzle: "cond_Drizzle",
      snow: "cond_Snow", clouds: "cond_Clouds", clear: "cond_Clear", atmosphere: "cond_Haze",
    };
    return t(lang, byKind[cls.kind] || "cond_unknown");
  }

  /* ============================ 4. activities ============================ */

  const ACTIVITIES = {
    walking: {
      name: { en: "Walking", hi: "टहलना" }, intensity: "low", outdoor: true,
      feelsMax: 40, windMax: 45, popMax: 65, visMin: 3,
      indoor: { en: "Mall / indoor corridor walk", hi: "मॉल / इनडोर कॉरिडोर में टहलें" },
    },
    running: {
      name: { en: "Running", hi: "दौड़ना" }, intensity: "high", outdoor: true,
      feelsMax: 35, windMax: 32, popMax: 40, visMin: 4,
      indoor: { en: "Treadmill / gym", hi: "ट्रेडमिल / जिम" },
    },
    cycling: {
      name: { en: "Cycling", hi: "साइकिल चलाना" }, intensity: "moderate", outdoor: true,
      feelsMax: 36, windMax: 30, popMax: 40, visMin: 4,
      indoor: { en: "Stationary bike / spin class", hi: "स्टेशनरी बाइक / स्पिन क्लास" },
    },
    cricket: {
      name: { en: "Cricket", hi: "क्रिकेट" }, intensity: "moderate", outdoor: true,
      feelsMax: 38, windMax: 35, popMax: 55, visMin: 3,
      indoor: { en: "Indoor nets / box cricket", hi: "इनडोर नेट्स / बॉक्स क्रिकेट" },
    },
    football: {
      name: { en: "Football", hi: "फुटबॉल" }, intensity: "high", outdoor: true,
      feelsMax: 35, windMax: 35, popMax: 45, visMin: 4,
      indoor: { en: "Indoor futsal / gym", hi: "इनडोर फुटसल / जिम" },
    },
    badminton: {
      name: { en: "Badminton", hi: "बैडमिंटन" }, intensity: "moderate", outdoor: false,
      feelsMax: 38, windMax: 20, popMax: 50, visMin: 3,
      indoor: { en: "Indoor badminton court", hi: "इनडोर बैडमिंटन कोर्ट" },
    },
    tennis: {
      name: { en: "Tennis", hi: "टेनिस" }, intensity: "moderate", outdoor: true,
      feelsMax: 36, windMax: 28, popMax: 45, visMin: 4,
      indoor: { en: "Indoor tennis court", hi: "इनडोर टेनिस कोर्ट" },
    },
    basketball: {
      name: { en: "Basketball", hi: "बास्केटबॉल" }, intensity: "high", outdoor: true,
      feelsMax: 36, windMax: 32, popMax: 45, visMin: 4,
      indoor: { en: "Indoor court / gym", hi: "इनडोर कोर्ट / जिम" },
    },
    yoga: {
      name: { en: "Yoga", hi: "योग" }, intensity: "low", outdoor: true,
      feelsMax: 38, windMax: 30, popMax: 55, visMin: 2,
      indoor: { en: "Indoor yoga / home mat", hi: "इनडोर योग / घर पर मैट" },
    },
    gym: {
      name: { en: "Gym workout", hi: "जिम वर्कआउट" }, intensity: "moderate", outdoor: false,
      feelsMax: 60, windMax: 200, popMax: 100, visMin: 0,
      indoor: { en: "Indoor gym (weather-proof)", hi: "इनडोर जिम (मौसम से अप्रभावित)" },
    },
    swimming: {
      name: { en: "Swimming", hi: "तैराकी" }, intensity: "moderate", outdoor: true,
      feelsMax: 42, windMax: 35, popMax: 50, visMin: 3,
      indoor: { en: "Indoor pool", hi: "इनडोर पूल" },
    },
    picnic: {
      name: { en: "Picnic / outing", hi: "पिकनिक / घूमना" }, intensity: "low", outdoor: true,
      feelsMax: 37, windMax: 35, popMax: 35, visMin: 4,
      indoor: { en: "Indoor café / museum", hi: "इनडोर कैफ़े / संग्रहालय" },
    },
    hiking: {
      name: { en: "Hiking / trek", hi: "ट्रेकिंग" }, intensity: "high", outdoor: true,
      feelsMax: 34, windMax: 32, popMax: 35, visMin: 5,
      indoor: { en: "Postpone — no safe indoor equivalent", hi: "टालें — कोई सुरक्षित इनडोर विकल्प नहीं" },
    },
  };
  const ACTIVITY_KEYS = ["walking", "running", "cycling", "cricket", "football", "badminton",
    "tennis", "basketball", "yoga", "swimming", "picnic", "hiking", "gym"];

  /* -------- scoring profile (a general "outdoor comfort" weighting) ------- */
  const PROFILE = {
    weights: { feels: 0.32, humidity: 0.15, wind: 0.15, precip: 0.20, uv: 0.07, aqi: 0.07, vis: 0.04 },
    highIntensity: { feels: 0.38, humidity: 0.17, wind: 0.13, precip: 0.17, uv: 0.05, aqi: 0.06, vis: 0.04 },
  };

  function penaltyFeels(f) {
    if (f == null) return null;
    if (f > 27) return clamp((f - 27) * 6, 0, 100);
    if (f < 18) return clamp((18 - f) * 5, 0, 100);
    return 0;
  }
  function penaltyHumidity(h, feels) {
    if (h == null) return null;
    const warm = feels != null && feels >= 27;
    if (warm) {
      if (h > 85) return 80; if (h > 75) return 55; if (h > 65) return 32; if (h > 55) return 14;
      if (h < 25) return 20; if (h < 35) return 8; return 0;
    }
    if (h > 90) return 45; if (h > 80) return 25; if (h < 20) return 12; if (h < 30) return 5; return 0;
  }
  function penaltyWind(v) {
    if (v == null) return null;
    if (v < 12) return 0; if (v < 20) return 12; if (v < 30) return 30;
    if (v < 40) return 55; if (v < 55) return 80; return 100;
  }
  function penaltyPrecip(popPct, precipMm, precipKind, thunder) {
    let p = 0;
    if (popPct != null) p = clamp(popPct * 0.55, 0, 60);
    if (precipMm != null && precipMm > 0.2) p = Math.max(p, clamp(precipMm * 12, 0, 80));
    if (precipKind === "snow") p = Math.max(p, 70);
    if (thunder) p = Math.max(p, 95);
    return clamp(p, 0, 100);
  }
  function penaltyUV(uv) {
    if (uv == null) return null;
    if (uv < 3) return 0; if (uv < 6) return 12; if (uv < 8) return 28; if (uv < 11) return 50; return 75;
  }
  function penaltyAQI(aqi) {
    if (aqi == null) return null;
    return { 1: 0, 2: 12, 3: 30, 4: 60, 5: 90 }[aqi] != null ? { 1: 0, 2: 12, 3: 30, 4: 60, 5: 90 }[aqi] : null;
  }
  function penaltyVis(km) {
    if (km == null) return null;
    if (km > 10) return 0; if (km > 6) return 10; if (km > 3) return 25; if (km > 1.5) return 50; return 75;
  }

  function bandOf(score) {
    if (score >= 85) return { key: "excellent", tone: "good" };
    if (score >= 70) return { key: "good", tone: "good" };
    if (score >= 55) return { key: "fair", tone: "warn" };
    if (score >= 40) return { key: "poor", tone: "warn" };
    return { key: "bad", tone: "bad" };
  }
  function bandLabel(lang, key) {
    const map = { excellent: "band_excellent", good: "band_good", fair: "band_fair", poor: "band_poor", bad: "band_bad" };
    return t(lang, map[key] || "band_good");
  }

  // Core micro-evaluation shared by comfort + activities.
  // input: {feels, humidity, windKmh, pop, precipMm, precipKind, thunder, uv, aqi, visKm}
  function microScore(input, profile) {
    const w = profile || PROFILE.weights;
    const dims = [
      ["feels", penaltyFeels(input.feels), w.feels],
      ["humidity", penaltyHumidity(input.humidity, input.feels), w.humidity],
      ["wind", penaltyWind(input.windKmh), w.wind],
      ["precip", penaltyPrecip(input.pop, input.precipMm, input.precipKind, input.thunder), w.precip],
      ["uv", penaltyUV(input.uv), w.uv],
      ["aqi", penaltyAQI(input.aqi), w.aqi],
      ["visibility", penaltyVis(input.visKm), w.vis],
    ];
    let ded = 0;
    const factors = [];
    dims.forEach((d) => {
      if (d[1] == null) { factors.push({ key: d[0], penalty: null, deduction: 0, included: false }); return; }
      const dd = d[1] * d[2];
      ded += dd;
      factors.push({ key: d[0], penalty: d[1], deduction: dd, included: true });
    });
    const score = clamp(100 - ded, 0, 100);
    return { score: score, factors: factors };
  }

  /* ======================= 5. context normalisation ====================== */

  function localParts(dt, tz) {
    const d = new Date((dt + (tz || 0)) * 1000);
    return { hour: d.getUTCHours(), min: d.getUTCMinutes(), date: d.toISOString().slice(0, 10), day: d.getUTCDay(), obj: d };
  }
  function isDayNowFrom(dt, sunrise, sunset) {
    if (dt == null || sunrise == null || sunset == null) return true;
    return dt >= sunrise && dt <= sunset;
  }

  function buildContext(store) {
    const ctx = { available: false, store: store || null };
    const cur = store && store.current;
    if (!cur || !cur.main) return ctx;
    const tz = n(cur.timezone) || 0;
    const w0 = (cur.weather && cur.weather[0]) || {};
    const cls = classify(w0.id, w0.main);

    ctx.available = true;
    ctx.city = cur.name || "—";
    ctx.country = (cur.sys && cur.sys.country) || "";
    ctx.lat = cur.coord ? cur.coord.lat : null;
    ctx.lon = cur.coord ? cur.coord.lon : null;
    ctx.tz = tz;
    ctx.updatedAt = store.updatedAt || Date.now();
    ctx.sources = { weather: "OpenWeatherMap", env: store.env ? "Open-Meteo" : null, aqi: store.aqi ? "OpenWeatherMap" : null };

    ctx.now = {
      temp: n(cur.main.temp), feels: n(cur.main.feels_like),
      humidity: n(cur.main.humidity), pressure: n(cur.main.pressure),
      windKmh: cur.wind && n(cur.wind.speed) != null ? round(cur.wind.speed * MPS_TO_KMH, 1) : null,
      gustKmh: cur.wind && n(cur.wind.gust) != null ? round(cur.wind.gust * MPS_TO_KMH, 1) : null,
      windDeg: cur.wind ? n(cur.wind.deg) : null,
      clouds: cur.clouds ? n(cur.clouds.all) : null,
      visibilityKm: n(cur.visibility) != null ? round(cur.visibility / 1000, 1) : null,
      main: w0.main || null, desc: w0.description || null, id: n(w0.id), icon: w0.icon || null,
      rain1h: cur.rain && n(cur.rain["1h"]) != null ? cur.rain["1h"] : null,
      snow1h: cur.snow && n(cur.snow["1h"]) != null ? cur.snow["1h"] : null,
      sunrise: cur.sys ? n(cur.sys.sunrise) : null,
      sunset: cur.sys ? n(cur.sys.sunset) : null,
      dt: n(cur.dt),
      kind: cls.kind, precip: cls.precip, severity: cls.severity, severe: cls.severe,
    };
    ctx.now.isDay = isDayNowFrom(ctx.now.dt, ctx.now.sunrise, ctx.now.sunset);
    ctx.now.heatIndex = heatIndexC(ctx.now.temp, ctx.now.humidity);
    ctx.now.windChill = windChillC(ctx.now.temp, ctx.now.windKmh);
    ctx.now.dewPoint = dewPointC(ctx.now.temp, ctx.now.humidity);
    ctx.now.windDir = compass(ctx.now.windDeg);

    /* --- air quality (OpenWeatherMap 1..5 scale) --- */
    const aq = store.aqi && store.aqi.list && store.aqi.list[0];
    if (aq && aq.main) {
      ctx.aqi = {
        value: n(aq.main.aqi), pm25: aq.components ? n(aq.components.pm2_5) : null,
        pm10: aq.components ? n(aq.components.pm10) : null, co: aq.components ? n(aq.components.co) : null,
        no2: aq.components ? n(aq.components.no2) : null, o3: aq.components ? n(aq.components.o3) : null,
        so2: aq.components ? n(aq.components.so2) : null, scale: "OpenWeatherMap 1-5", source: "OpenWeatherMap",
      };
    } else ctx.aqi = null;

    /* --- environmental hourly detail (Open-Meteo, optional) --- */
    const env = store.env;
    if (env && env.hourly && env.hourly.time) {
      ctx.env = {
        source: "Open-Meteo",
        current: env.current || null,
        time: env.hourly.time,
        temp: env.hourly.temperature_2m || [],
        feels: env.hourly.apparent_temperature || [],
        humidity: env.hourly.relative_humidity_2m || [],
        pop: env.hourly.precipitation_probability || [],
        precip: env.hourly.precipitation || [],
        wind: env.hourly.wind_speed_10m || [],
        uv: env.hourly.uv_index || [],
        code: env.hourly.weather_code || [],
        visibility: env.hourly.visibility || [],
      };
      ctx.uv = ctx.env.current && n(ctx.env.current.uv_index) != null
        ? round(ctx.env.current.uv_index, 1)
        : (ctx.env.uv.length ? round(ctx.env.uv[0], 1) : null);
    } else { ctx.env = null; ctx.uv = null; }

    /* --- 3-hour forecast slots from OpenWeatherMap --- */
    ctx.hours = [];
    ctx.days = [];
    const list = store.forecast && store.forecast.list ? store.forecast.list : null;
    if (list) {
      const byDay = {};
      list.forEach((it) => {
        const lp = localParts(it.dt, tz);
        const w = (it.weather && it.weather[0]) || {};
        const c = classify(w.id, w.main);
        const slot = {
          dt: it.dt, hour: lp.hour, date: lp.date,
          temp: n(it.main.temp), feels: n(it.main.feels_like), humidity: n(it.main.humidity),
          windKmh: n(it.wind && it.wind.speed) != null ? round(it.wind.speed * MPS_TO_KMH, 1) : null,
          pop: n(it.pop) != null ? Math.round(it.pop * 100) : null,
          main: w.main, id: n(w.id), desc: w.description, icon: w.icon,
          kind: c.kind, precip: c.precip, severity: c.severity, severe: c.severe,
          thunder: c.kind === "thunder", isDay: (it.sys && it.sys.pod) ? it.sys.pod === "d" : true,
        };
        ctx.hours.push(slot);
        if (!byDay[lp.date]) byDay[lp.date] = { date: lp.date, min: slot.temp, max: slot.temp, pop: slot.pop || 0, kinds: {}, ids: [], day: lp.day };
        const d = byDay[lp.date];
        if (slot.temp != null) { d.min = Math.min(d.min, slot.temp); d.max = Math.max(d.max, slot.temp); }
        if (slot.pop != null) d.pop = Math.max(d.pop, slot.pop);
        if (slot.kind) d.kinds[slot.kind] = (d.kinds[slot.kind] || 0) + 1;
        if (slot.id != null) d.ids.push(slot.id);
      });
      ctx.days = Object.keys(byDay).sort().map((k) => {
        const d = byDay[k];
        let kind = "clouds";
        let best = 0;
        Object.keys(d.kinds).forEach((kk) => { if (d.kinds[kk] > best) { best = d.kinds[kk]; kind = kk; } });
        // prefer the most "notable" weather of the day
        ["thunder", "snow", "rain", "drizzle", "atmosphere", "clouds", "clear"].some((p) => {
          if (d.kinds[p]) { kind = p; return true; }
          return false;
        });
        return { date: d.date, day: d.day, min: n(d.min), max: n(d.max), pop: n(d.pop), kind: kind };
      });
    }

    /* --- normalised hourly timeline used for best-window search --- */
    ctx.timeline = [];
    if (ctx.env) {
      const E = ctx.env;
      for (let i = 0; i < E.time.length; i++) {
        const s = E.time[i]; // ISO local e.g. 2026-10-11T15:00
        const hour = parseInt(s.slice(11, 13), 10);
        const info = wmoInfo(E.code[i]);
        ctx.timeline.push({
          iso: s, date: s.slice(0, 10), hour: hour,
          temp: n(E.temp[i]), feels: n(E.feels[i]), humidity: n(E.humidity[i]),
          windKmh: n(E.wind[i]), pop: n(E.pop[i]), precipMm: n(E.precip[i]),
          uv: n(E.uv[i]), visKm: n(E.visibility[i]) != null ? round(E.visibility[i] / 1000, 1) : null,
          kind: info.kind, precip: info.precip, severity: info.severity, severe: info.severe,
          thunder: info.kind === "thunder",
          source: "Open-Meteo",
        });
      }
    } else {
      ctx.hours.forEach((h) => {
        ctx.timeline.push({
          iso: null, date: h.date, hour: h.hour, temp: h.temp, feels: h.feels, humidity: h.humidity,
          windKmh: h.windKmh, pop: h.pop, precipMm: null, uv: null, visKm: null,
          kind: h.kind, precip: h.precip, severity: h.severity, severe: h.severe, thunder: h.thunder,
          source: "OpenWeatherMap",
        });
      });
    }
    return ctx;
  }

  /* ============================ 6. factors =============================== */

  function factorDetail(lang, key, value) {
    const en = {
      f_feels: (v) => v + "°C feels-like",
      f_humidity: (v) => v + "% humidity",
      f_wind: (v) => v + " km/h wind",
      f_precip: (v) => v + "% rain chance",
      f_uv: (v) => "UV " + v,
      f_aqi: (v) => "AQI " + v,
      f_visibility: (v) => v + " km visibility",
    };
    const hi = {
      f_feels: (v) => "महसूस " + v + "°C",
      f_humidity: (v) => "नमी " + v + "%",
      f_wind: (v) => "हवा " + v + " किमी/घं",
      f_precip: (v) => "बारिश की संभावना " + v + "%",
      f_uv: (v) => "यूवी " + v,
      f_aqi: (v) => "AQI " + v,
      f_visibility: (v) => "दृश्यता " + v + " किमी",
    };
    const L = pickLang(lang);
    const fn = (L === "hi" ? hi : en)[key];
    return fn && value != null ? fn(value) : "";
  }

  /* ============================ 7. warnings ============================== */

  function warnings(ctx, lang) {
    const out = [];
    if (!ctx.available) return out;
    const now = ctx.now;
    const near = ctx.timeline.slice(0, 3);
    const thunderNow = now.kind === "thunder" || near.some((s) => s.thunder);
    const heavyNow = ["heavy", "extreme"].indexOf(now.severity) >= 0 && now.precip === "rain";
    const heavySoon = near.some((s) => (s.severity === "heavy" || s.severity === "extreme") && s.precip === "rain");
    const snowSoon = now.precip === "snow" || near.some((s) => s.precip === "snow" && (s.severity === "heavy" || s.severity === "extreme"));

    if (thunderNow) out.push({ level: "danger", key: "w_tstorm", title: t(lang, "w_tstorm"), text: t(lang, "w_tstorm_t") });
    if (now.kind === "squall" || now.kind === "tornado")
      out.push({ level: "danger", key: "w_squall", title: t(lang, "w_squall"), text: t(lang, "w_squall_t") });
    if (hardNow(now)) out.push({ level: "danger", key: "w_heavyrain", title: t(lang, "w_heavyrain"), text: t(lang, "w_heavyrain_t") });
    else if (heavySoon && !thunderNow) out.push({ level: "warning", key: "w_heavyrain", title: t(lang, "w_heavyrain"), text: t(lang, "w_heavyrain_t") });
    if (snowSoon) out.push({ level: "warning", key: "w_snow", title: t(lang, "w_snow"), text: t(lang, "w_snow_t") });
    if (now.id === 511) out.push({ level: "danger", key: "w_freezing", title: t(lang, "w_freezing"), text: t(lang, "w_freezing_t") });

    const visKm = now.visibilityKm != null ? now.visibilityKm : (ctx.env && ctx.env.visibility.length ? round(ctx.env.visibility[0] / 1000, 1) : null);
    if (visKm != null && visKm < 1.5)
      out.push({ level: "warning", key: "w_fog", title: t(lang, "w_fog"), text: t(lang, "w_fog_t") });

    const hot = now.feels != null ? now.feels : now.temp;
    if (hot != null && hot >= 41)
      out.push({ level: "danger", key: "w_heat", title: t(lang, "w_heat"), text: t(lang, "w_heat_t") });
    else if (hot != null && hot >= 38)
      out.push({ level: "warning", key: "w_heat", title: t(lang, "w_heat"), text: t(lang, "w_heat_t") });

    if (hot != null && hot <= 0)
      out.push({ level: "warning", key: "w_cold", title: t(lang, "w_cold"), text: t(lang, "w_cold_t") });

    if (ctx.uv != null && ctx.uv >= 8)
      out.push({ level: "warning", key: "w_uv", title: t(lang, "w_uv"), text: t(lang, "w_uv_t") });

    if (ctx.aqi && ctx.aqi.value >= 5)
      out.push({ level: "danger", key: "w_aqi", title: t(lang, "w_aqi"), text: t(lang, "w_aqi_t") });
    else if (ctx.aqi && ctx.aqi.value === 4)
      out.push({ level: "warning", key: "w_aqi", title: t(lang, "w_aqi"), text: t(lang, "w_aqi_t") });

    if (now.windKmh != null && now.windKmh >= 50)
      out.push({ level: "warning", key: "w_wind", title: t(lang, "w_wind"), text: t(lang, "w_wind_t") });
    else if (now.windKmh != null && now.windKmh >= 38)
      out.push({ level: "info", key: "w_wind", title: t(lang, "w_wind"), text: t(lang, "w_wind_t") });

    if (out.length === 0 && (now.precip === "rain" || (near[0] && near[0].pop != null && near[0].pop >= 50)))
      out.push({ level: "info", key: "w_rain", title: t(lang, "w_rain"), text: t(lang, "w_rain_t") });

    return out;
  }
  function hardNow(now) {
    return now.precip === "rain" && (now.severity === "heavy" || now.severity === "extreme");
  }

  /* ============================ 8. comfort =============================== */

  function factorValueFor(key, ctx) {
    const now = ctx.now;
    if (key === "feels") return now.feels != null ? Math.round(now.feels) : (now.temp != null ? Math.round(now.temp) : null);
    if (key === "humidity") return now.humidity != null ? Math.round(now.humidity) : null;
    if (key === "wind") return now.windKmh != null ? Math.round(now.windKmh) : null;
    if (key === "precip") return ctx.nextPop != null ? ctx.nextPop : (now.precip !== "none" ? 90 : 0);
    if (key === "uv") return ctx.uv != null ? Math.round(ctx.uv) : null;
    if (key === "aqi") return ctx.aqi ? ctx.aqi.value : null;
    if (key === "visibility") return now.visibilityKm != null ? Math.round(now.visibilityKm) : null;
    return null;
  }

  // rain chance over the next ~6 hours (max of the next two 3h slots)
  function nextPop(ctx) {
    let p = null;
    const near = ctx.timeline.slice(0, 3);
    near.forEach((s) => { if (s.pop != null) p = p == null ? s.pop : Math.max(p, s.pop); });
    if (p == null && ctx.now.precip !== "none") p = 90;
    return p;
  }

  function assess(ctx, lang) {
    if (!ctx.available) return { available: false };
    ctx.nextPop = nextPop(ctx);
    const input = {
      feels: ctx.now.feels != null ? ctx.now.feels : ctx.now.temp,
      humidity: ctx.now.humidity, windKmh: ctx.now.windKmh,
      pop: ctx.nextPop, precipMm: ctx.now.rain1h,
      precipKind: ctx.now.precip, thunder: ctx.now.kind === "thunder",
      uv: ctx.uv, aqi: ctx.aqi ? ctx.aqi.value : null, visKm: ctx.now.visibilityKm,
    };
    const opt = OPTIONAL_KEYS(ctx);
    const prof = opt.highIntensity ? PROFILE.highIntensity : PROFILE.weights;
    const res = microScore({ ...input, feels: input.feels }, prof);

    // hard hazard caps — safety must never depend on temperature alone
    const caps = [];
    const near = ctx.timeline.slice(0, 3);
    if (input.thunder || near.some((s) => s.thunder)) caps.push({ score: 22, key: "thunder" });
    if (hardNow(ctx.now) || ctx.now.kind === "squall" || ctx.now.kind === "tornado" || ctx.now.id === 511) caps.push({ score: 30, key: "severe" });
    if (ctx.now.precip === "snow" && (ctx.now.severity === "heavy" || ctx.now.severity === "extreme")) caps.push({ score: 32, key: "snow" });
    if (input.feels != null && input.feels >= 41) caps.push({ score: 28, key: "heat" });
    if (input.feels != null && input.feels <= -5) caps.push({ score: 25, key: "cold" });
    if (ctx.now.windKmh != null && ctx.now.windKmh >= 55) caps.push({ score: 35, key: "wind" });
    if (ctx.aqi && ctx.aqi.value === 5) caps.push({ score: 40, key: "aqi" });
    if (input.visKm != null && input.visKm < 1) caps.push({ score: 40, key: "fog" });

    let score = res.score;
    if (caps.length) score = Math.min(score, Math.min.apply(null, caps.map((c) => c.score)));
    score = Math.round(score);
    const band = bandOf(score);

    const factors = res.factors.map((f) => {
      const val = factorValueFor(f.key, ctx);
      const tone = f.penalty == null ? "muted" : (f.penalty <= 8 ? "good" : (f.penalty <= 35 ? "warn" : "bad"));
      return {
        key: f.key, label: t(lang, "f_" + (f.key === "vis" ? "visibility" : f.key)),
        value: val, detail: factorDetail(lang, "f_" + (f.key === "vis" ? "visibility" : f.key), val),
        deduction: Math.round(f.deduction), tone: tone, available: f.penalty != null,
      };
    });

    // recommended activities: evaluate all outdoor activities, keep the pleasant ones
    const list = ACTIVITY_KEYS.map((k) => evaluateActivity(ctx, k, lang, null, true))
      .filter((a) => a.score != null)
      .sort((a, b) => b.score - a.score);
    const good = list.filter((a) => a.score >= 65).slice(0, 4).map((a) => a.name);
    const bad = list.filter((a) => a.ratingKey === "avoid").map((a) => a.name);

    return {
      available: true, score: score,
      band: { key: band.key, label: bandLabel(lang, band.key), tone: band.tone },
      factors: factors, caps: caps,
      goodActivities: good, avoidActivities: bad,
      warnings: warnings(ctx, lang),
      disclaimer: t(lang, "comfort_disclaimer"),
    };
  }
  function OPTIONAL_KEYS() { return { highIntensity: false }; }

  /* ============================ 9. activities ============================ */

  function rateOf(score) {
    if (score >= 80) return { key: "great", tone: "good" };
    if (score >= 65) return { key: "good", tone: "good" };
    if (score >= 50) return { key: "caution", tone: "warn" };
    return { key: "avoid", tone: "bad" };
  }
  function rateLabel(lang, key) {
    return t(lang, "rating_" + (key === "great" ? "great" : key === "good" ? "good" : key === "caution" ? "caution" : "avoid"));
  }

  function evaluateActivity(ctx, key, lang, when, isShort) {
    const def = ACTIVITIES[key];
    if (!def || !ctx.available) return { key: key, name: def ? def.name[pickLang(lang)] : key, score: null };
    const slot = when != null ? when : null;
    const src = slot || ctx.now;
    const feels = slot ? slot.feels : (ctx.now.feels != null ? ctx.now.feels : ctx.now.temp);
    const humidity = slot ? slot.humidity : ctx.now.humidity;
    const windKmh = slot ? slot.windKmh : ctx.now.windKmh;
    const pop = slot ? slot.pop : ctx.nextPop;
    const uv = slot ? slot.uv : ctx.uv;
    const visKm = slot ? slot.visKm : ctx.now.visibilityKm;
    const thunder = slot ? !!slot.thunder : (ctx.now.kind === "thunder");
    const precipMm = slot ? slot.precipMm : ctx.now.rain1h;
    const precipKind = slot ? slot.precip : ctx.now.precip;

    const prof = def.intensity === "high" ? PROFILE.highIntensity : PROFILE.weights;
    const res = microScore({ feels: feels, humidity: humidity, windKmh: windKmh, pop: pop, precipMm: precipMm, precipKind: precipKind, thunder: thunder, uv: uv, aqi: ctx.aqi ? ctx.aqi.value : null, visKm: visKm }, prof);

    let score = res.score;
    const reasons = [];

    // activity-specific hard gates
    if (thunder) { score = Math.min(score, 18); reasons.push(t(lang, "w_tstorm")); }
    if (precipKind === "snow" && (slot ? true : ctx.now.precip === "snow")) score = Math.min(score, 40);
    if (feels != null && feels >= def.feelsMax + 3) { score = Math.min(score, 35); }
    if (windKmh != null && windKmh >= def.windMax + 10) { score = Math.min(score, 40); }
    if (pop != null && pop >= def.popMax + 25) { score = Math.min(score, 45); }
    if (ctx.aqi && ctx.aqi.value >= 5) { score = Math.min(score, def.intensity === "high" ? 25 : 40); }
    else if (ctx.aqi && ctx.aqi.value === 4 && def.intensity === "high") score = Math.min(score, 45);
    if (visKm != null && visKm < def.visMin) score = Math.min(score, 45);

    score = Math.round(clamp(score, 0, 100));
    const rating = rateOf(score);

    const tips = [];
    if (feels != null && feels >= 32) tips.push(pickLang(lang) === "hi" ? "तापमान अधिक — जल्दी थकान हो सकती है" : "Feels hot — expect faster fatigue");
    if (humidity != null && humidity >= 75) tips.push(pickLang(lang) === "hi" ? "नमी अधिक — पसीना जल्दी रुकेगा" : "High humidity — sweat won't evaporate well");
    if (pop != null && pop >= 40) tips.push(pickLang(lang) === "hi" ? "बारिश की संभावना — छाता रखें" : "Rain likely — keep an umbrella");
    if (uv != null && uv >= 6) tips.push(pickLang(lang) === "hi" ? "यूवी अधिक — सनस्क्रीन लगाएँ" : "High UV — use sunscreen");
    if (windKmh != null && windKmh >= 25) tips.push(pickLang(lang) === "hi" ? "तेज़ हवा — गेंद उड़ सकती है" : "Windy — ball/equipment may drift");

    const indoor = def.indoor ? def.indoor[pickLang(lang)] : null;
    return {
      key: key, name: def.name[pickLang(lang)], score: score,
      ratingKey: rating.key, rating: rateLabel(lang, rating.key), tone: rating.tone,
      reasons: reasons, tips: tips, indoor: indoor, def: def,
    };
  }

  /* ---------- best window search ---------- */
  function windowLabel(lang, tl) {
    const L = pickLang(lang);
    const h = tl.hour;
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    if (L === "hi") {
      const part = h < 12 ? "सुबह" : h < 17 ? "दोपहर" : h < 21 ? "शाम" : "रात";
      return part + " " + h12 + " बजे";
    }
    return h12 + " " + ampm;
  }

  function bestWindow(ctx, lang, activityKey) {
    if (!ctx.available || !ctx.timeline.length) return null;
    const def = activityKey ? ACTIVITIES[activityKey] : null;
    const prof = def && def.intensity === "high" ? PROFILE.highIntensity : PROFILE.weights;
    const nowMs = Date.now();
    let best = null;
    ctx.timeline.forEach((s, i) => {
      // skip the immediate past (Open-Meteo returns from 00:00 of today)
      if (s.iso) {
        const ts = Date.parse(s.iso);
        if (!isNaN(ts) && ts < nowMs - 60 * 60 * 1000) return;
      }
      // outdoor activities only make sense in daylight
      if (def && def.outdoor && (s.hour < 6 || s.hour > 20)) return;
      const res = microScore({
        feels: s.feels, humidity: s.humidity, windKmh: s.windKmh, pop: s.pop,
        precipMm: s.precipMm, precipKind: s.precip, thunder: s.thunder,
        uv: s.uv, aqi: ctx.aqi ? ctx.aqi.value : null, visKm: s.visKm,
      }, prof);
      let sc = res.score;
      if (s.thunder) sc = Math.min(sc, 15);
      const isTomorrow = s.date !== ctx.timeline[0].date;
      if (best == null || sc > best.score) best = { slot: s, score: sc, index: i, isTomorrow: isTomorrow };
    });
    if (!best) return null;
    return {
      score: Math.round(best.score), band: bandOf(Math.round(best.score)),
      start: best.slot, label: windowLabel(lang, best.slot),
      tomorrow: best.isTomorrow, slot: best.slot,
    };
  }

  /* ============================ 10. clothing ============================= */

  function clothing(ctx, lang) {
    const L = pickLang(lang);
    const hi = L === "hi";
    const now = ctx.now;
    const feels = now.feels != null ? now.feels : now.temp;
    const uv = ctx.uv;
    const pop = ctx.nextPop;
    const items = [];
    const push = (txt) => { if (items.indexOf(txt) < 0) items.push(txt); };

    if (feels != null) {
      if (feels <= 5) push(hi ? "भारी जैकेट + थर्मल, टोपी, दस्ताने" : "Heavy jacket + thermals, beanie, gloves");
      else if (feels <= 12) push(hi ? "बर्फ़ीली हवा के लिए गरम जैकेट" : "Warm jacket for the chill");
      else if (feels <= 18) push(hi ? "जैकेट या स्वेटर लें" : "A jacket or sweater is a good idea");
      else if (feels <= 24) push(hi ? "हल्का कुर्ता/शर्ट, ज़रूरत पर हल्का स्वेटर" : "Light shirt/kurta, maybe a light layer");
      else if (feels <= 30) push(hi ? "सूती, हवादार कपड़े पहनें" : "Breathable cotton clothes");
      else push(hi ? "ढीले, हल्के रंग के सूती कपड़े" : "Loose, light-coloured cotton clothes");
    }
    if (now.humidity != null && now.humidity >= 80 && feels != null && feels >= 28)
      push(hi ? "नमी के कारण सिंथेटिक से बचें, सूती चुनें" : "High humidity — prefer cotton over synthetics");
    if (uv != null && uv >= 3) push(hi ? "सनस्क्रीन (SPF 30+) लगाएँ" : "Apply sunscreen (SPF 30+)");
    if (uv != null && uv >= 6) { push(hi ? "धूप का चश्मा" : "Sunglasses"); push(hi ? "कैप या हैट" : "Cap or hat"); }
    if (feels != null && feels >= 32) push(hi ? "पानी की बोतल साथ रखें" : "Carry a water bottle");
    if (pop != null && pop >= 40) push(hi ? "छाता या रेनकोट लें" : "Take an umbrella or raincoat");
    else if (pop != null && pop >= 20) push(hi ? "छोटा छाता रखना अच्छा रहेगा" : "A compact umbrella may help");
    if (now.kind === "rain" || now.kind === "thunder" || now.kind === "drizzle")
      push(hi ? "वॉटरप्रूफ़ फुटवियर" : "Waterproof footwear");
    if (now.windKmh != null && now.windKmh >= 25) push(hi ? "हवा से बचने के लिए हल्का विंडप्रूफ़ जैकेट" : "A light windproof layer against the wind");
    if (ctx.aqi && ctx.aqi.value >= 4) push(hi ? "अच्छी मास्क (N95) बाहर के लिए" : "A good mask (N95) for outdoors");
    if (now.visibilityKm != null && now.visibilityKm < 2) push(hi ? "कोहरे में चलते समय ऊँची दृश्यता वाले कपड़े" : "Wear visible/bright clothing in poor visibility");
    if (now.kind === "snow") push(hi ? "गरम मोज़े और वॉटरप्रूफ़ जूते" : "Warm socks and waterproof shoes");
    if (!items.length) push(hi ? "आज कोई ख़ास सामान ज़रूरी नहीं लगता" : "Nothing special needed for today");
    return items;
  }

  /* ============================ 11. food & hydration =================== */

  function activityLevelFromCtx(ctx) {
    // crude: hotter + more humid means more fluid loss
    const feels = ctx.now.feels != null ? ctx.now.feels : ctx.now.temp;
    if (feels == null) return "moderate";
    if (feels >= 34) return "high";
    if (feels >= 28) return "moderate";
    return "low";
  }

  function food(ctx, lang) {
    const L = pickLang(lang);
    const hi = L === "hi";
    const now = ctx.now;
    const feels = now.feels != null ? now.feels : now.temp;
    const warm = feels != null && feels >= 30;
    const humid = now.humidity != null && now.humidity >= 70;
    const cold = feels != null && feels <= 15;
    const wet = now.precip === "rain" || (ctx.nextPop != null && ctx.nextPop >= 55);

    const foods = [];
    const bump = (a) => a.forEach((x) => { if (foods.indexOf(x) < 0) foods.push(x); });

    if (warm && humid) {
      bump(hi ? ["दही / रायता", "छाछ (मट्ठा)", "खीरा, ककड़ी सलाद", "तरबूज़ / खरबूज़ा", "हल्की दाल + रोटी", "सत्तू का शरबत", "नींबू-पुदीना पानी"]
        : ["Curd / raita", "Buttermilk (chaas)", "Cucumber salad", "Watermelon / muskmelon", "Light dal + roti", "Sattu drink", "Lemon-mint water"]);
    } else if (warm) {
      bump(hi ? ["तरबूज़, खरबूज़ा, संतरा", "खीरा और टमाटर", "दही / लस्सी", "हल्की दाल और चावल", "मौसमी हरी सब्ज़ियाँ", "नारियल पानी"]
        : ["Watermelon, muskmelon, orange", "Cucumber and tomato", "Curd / lassi", "Light dal and rice", "Seasonal green vegetables", "Coconut water"]);
    } else if (cold) {
      bump(hi ? ["गरम खिचड़ी / दलिया", "राजमा-चावल", "गरम सूप", "अदरक-तुलसी की चाय", "सूखे मेवे और गुड़", "गरम परांठा (सीमित)"]
        : ["Warm khichdi / dalia", "Rajma-chawal", "Hot soups", "Ginger-tulsi tea", "Dry fruits and jaggery", "Warm paratha (in moderation)"]);
    } else {
      bump(hi ? ["दाल-रोटी + हरी सब्ज़ी", "दही / रायता", "मौसमी फल", "भुने चने / मखाना", "हल्का पुलाव"]
        : ["Dal-roti + green veg", "Curd / raita", "Seasonal fruit", "Roasted chana / makhana", "Light pulao"]);
    }
    if (wet) bump(hi ? ["गरम सूप या खिचड़ी (सड़क किनारे कच्चा सलाद/कटा फल टालें)"]
      : ["Warm soup or khichdi (avoid roadside raw salads/cut fruit in the rain)"]);

    const hydration = [];
    const hbump = (a) => a.forEach((x) => { if (hydration.indexOf(x) < 0) hydration.push(x); });
    hbump(hi ? ["हर थोड़ी देर में पानी की कुछ घूँट पिएँ — प्यास लगने का इंतज़ार न करें"]
      : ["Sip water regularly — don't wait until you feel thirsty"]);
    if (warm) hbump(hi ? ["पानी-भरपूर फल और छाछ/नींबू पानी शामिल करें"] : ["Add water-rich fruits and chaas/lemon water"]);
    if (cold) hbump(hi ? ["गरम पानी/सूप से भी हाइड्रेशन बनाए रखें"] : ["Warm water/soups still count towards hydration"]);
    if (L === "hi") {
      hbump(["मात्रा हर व्यक्ति के लिए अलग होती है — वज़न, गतिविधि और मौसम पर निर्भर करती है",
        "तेज़ पेशाब का रंग बहुत गहरा हो तो और पानी पिएँ",
        "भारी पसीना आने पर नमक-चीनी (ORS) वाला घोल लें"]);
    } else {
      hbump(["Needs differ per person — depends on body, activity and weather",
        "Very dark urine is a simple sign you need more fluids",
        "If you sweat heavily, add an ORS / salt-sugar solution"]);
    }

    return { foods: foods, hydration: hydration };
  }

  /* ============================ 12. planner ============================= */

  function periodSummary(ctx, lang, hours, name) {
    const L = pickLang(lang);
    const seg = ctx.timeline.filter((s) => hours.indexOf(s.hour) >= 0).slice(0, 4);
    if (!seg.length) return null;
    const temps = seg.map((s) => s.temp).filter((x) => x != null);
    const feels = seg.map((s) => s.feels).filter((x) => x != null);
    const pops = seg.map((s) => s.pop).filter((x) => x != null);
    const maxPop = pops.length ? Math.max.apply(null, pops) : null;
    const thunder = seg.some((s) => s.thunder);
    const tMin = temps.length ? Math.round(Math.min.apply(null, temps)) : null;
    const tMax = temps.length ? Math.round(Math.max.apply(null, temps)) : null;
    const fMax = feels.length ? Math.round(Math.max.apply(null, feels)) : null;
    const label = t(lang, name);
    let verdict;
    if (thunder) verdict = L === "hi" ? "आंधी संभव — बाहर न जाएँ" : "Storms possible — stay in";
    else if (maxPop != null && maxPop >= 60) verdict = L === "hi" ? "बारिश की मोटी संभावना" : "Rain very likely";
    else if (maxPop != null && maxPop >= 35) verdict = L === "hi" ? "बारिश की संभावना" : "Some chance of rain";
    else if (fMax != null && fMax >= 36) verdict = L === "hi" ? "बहुत गरम" : "Very hot";
    else if (fMax != null && fMax >= 32) verdict = L === "hi" ? "गरम" : "Warm";
    else verdict = L === "hi" ? "आम तौर पर ठीक" : "Generally comfortable";
    return { name: label, tMin: tMin, tMax: tMax, feelsMax: fMax, pop: maxPop, thunder: thunder, verdict: verdict };
  }

  function planner(ctx, lang) {
    const L = pickLang(lang);
    const hi = L === "hi";
    const periods = [
      periodSummary(ctx, lang, [6, 7, 8, 9, 10, 11], "morning"),
      periodSummary(ctx, lang, [12, 13, 14, 15, 16], "afternoon"),
      periodSummary(ctx, lang, [17, 18, 19, 20, 21], "evening"),
    ].filter(Boolean);

    const walk = bestWindow(ctx, lang, "walking");
    const run = bestWindow(ctx, lang, "running");
    const windows = [];
    if (walk) windows.push({ activity: hi ? "टहलने" : "Walking", label: walk.label, band: bandLabel(lang, walk.band.key), tone: bandOf(walk.score).tone, tomorrow: walk.tomorrow });
    if (run) windows.push({ activity: hi ? "दौड़ने" : "Running", label: run.label, band: bandLabel(lang, run.band.key), tone: bandOf(run.score).tone, tomorrow: run.tomorrow });

    const checklist = [];
    const feels = ctx.now.feels != null ? ctx.now.feels : ctx.now.temp;
    const push = (x) => { if (checklist.indexOf(x) < 0) checklist.push(x); };
    push(hi ? "फ़ोन + पावर बैंक" : "Phone + power bank");
    if (feels != null && feels >= 30) push(hi ? "पानी की बोतल और नींबू-नमक" : "Water bottle + lemon-salt");
    if (ctx.nextPop != null && ctx.nextPop >= 40) push(hi ? "छाता / रेनकोट" : "Umbrella / raincoat");
    if (ctx.uv != null && ctx.uv >= 5) push(hi ? "सनस्क्रीन, चश्मा, कैप" : "Sunscreen, sunglasses, cap");
    if (ctx.aqi && ctx.aqi.value >= 4) push(hi ? "मास्क (N95)" : "Mask (N95)");
    if (ctx.now.kind === "rain" || ctx.now.kind === "drizzle") push(hi ? "पानी से बचने के लिए अतिरिक्त जोड़ी मोज़े/जूते" : "Extra socks/footwear to stay dry");
    if (feels != null && feels <= 15) push(hi ? "स्वेटर/जैकेट" : "Sweater/jacket");
    if (ctx.now.visibilityKm != null && ctx.now.visibilityKm < 2) push(hi ? "यात्रा में सावधानी व अतिरिक्त समय" : "Extra travel time & caution");

    const indoor = [];
    ["running", "cycling", "cricket", "badminton", "yoga"].forEach((k) => {
      const a = evaluateActivity(ctx, k, lang, null, true);
      if (a.indoor && a.score != null && a.score < 65) {
        indoor.push({ activity: a.name, alternative: a.indoor, rating: a.rating, tone: a.tone });
      }
    });

    return { periods: periods, windows: windows, checklist: checklist, indoor: indoor.slice(0, 4) };
  }

  /* ============================ 13. summary ============================= */

  function summaryLine(ctx, lang) {
    const L = pickLang(lang);
    const hi = L === "hi";
    const now = ctx.now;
    const cond = condLabel(lang, now.main, now.id);
    const temp = now.temp != null ? Math.round(now.temp) : null;
    const feels = now.feels != null ? Math.round(now.feels) : null;
    const pop = ctx.nextPop;
    const bits = [];
    if (hi) {
      bits.push("अभी " + ctx.city + " में " + cond + " है" + (temp != null ? " और तापमान " + temp + "°C" : ""));
      if (feels != null && temp != null && Math.abs(feels - temp) >= 2) bits.push("महसूस " + feels + "°C हो रहा है");
      if (now.humidity != null) bits.push("नमी " + Math.round(now.humidity) + "%");
      if (now.windKmh != null) bits.push("हवा " + Math.round(now.windKmh) + " किमी/घं");
      if (pop != null && pop >= 30) bits.push("अगले कुछ घंटों में बारिश की संभावना " + pop + "%");
      else if (now.precip === "rain") bits.push("अभी बारिश हो रही है");
    } else {
      bits.push("Right now " + ctx.city + " has " + cond.toLowerCase() + (temp != null ? " at " + temp + "°C" : ""));
      if (feels != null && temp != null && Math.abs(feels - temp) >= 2) bits.push("it feels like " + feels + "°C");
      if (now.humidity != null) bits.push("humidity " + Math.round(now.humidity) + "%");
      if (now.windKmh != null) bits.push("wind " + Math.round(now.windKmh) + " km/h");
      if (pop != null && pop >= 30) bits.push("about " + pop + "% chance of rain soon");
      else if (now.precip === "rain") bits.push("it is raining now");
    }
    if (ctx.aqi) bits.push((hi ? "वायु गुणवत्ता " : "air quality ") + t(lang, "aq_" + ctx.aqi.value).toLowerCase());
    return bits.join(hi ? ", " : ", ") + ".";
  }

  function actions(ctx, lang) {
    const L = pickLang(lang);
    const hi = L === "hi";
    const now = ctx.now;
    const deserves = [];
    const feels = now.feels != null ? now.feels : now.temp;
    const pop = ctx.nextPop;
    const w = bestWindow(ctx, lang, "walking");
    if (feels != null && feels >= 33) deserves.push(hi ? "दोपहर 12–4 बजे की धूप से बचें और छाया चुनें" : "Avoid midday sun (12–4 PM) and stay in the shade");
    if (feels != null && feels <= 10) deserves.push(hi ? "गरम कपड़े पहनें और सूखे रहें" : "Layer up and stay dry");
    if (pop != null && pop >= 40) deserves.push(hi ? "छाता साथ रखें और बाहरी योजना बदलने के लिए तैयार रहें" : "Keep an umbrella and be ready to shift outdoor plans");
    if (ctx.aqi && ctx.aqi.value >= 4) deserves.push(hi ? "व्यायाम सुबह जल्दी या इनडोर करें" : "Move exercise indoors or to early morning");
    if (ctx.uv != null && ctx.uv >= 6) deserves.push(hi ? "सनस्क्रीन लगाएँ और दोपहर में छाया लें" : "Sunscreen on, seek shade around midday");
    if (w && w.score >= 65) deserves.push(hi ? "बाहर निकलने का अच्छा समय: " + w.label + (w.tomorrow ? " (कल)" : "") : "Good time to head out: " + w.label + (w.tomorrow ? " (tomorrow)" : ""));
    if (now.windKmh != null && now.windKmh >= 30) deserves.push(hi ? "तेज़ हवा — ढीली चीज़ें सँभालें" : "Windy — secure loose items");
    if (!deserves.length) deserves.push(hi ? "आज मौसम सामान्य है — सामान्य दिनचर्या ठीक है" : "Weather looks normal today — a regular routine is fine");
    return deserves;
  }

  /* ============================ 14. briefing ============================ */

  function briefingSections(ctx, lang) {
    if (!ctx.available) return [];
    const L = pickLang(lang);
    const hi = L === "hi";
    const secs = [];
    secs.push({ key: "summary", title: t(lang, "sec_summary"), icon: "fa-cloud-sun", items: [summaryLine(ctx, lang)] });
    secs.push({ key: "actions", title: t(lang, "sec_actions"), icon: "fa-list-check", items: actions(ctx, lang) });
    const cloth = clothing(ctx, lang);
    if (cloth.length) secs.push({ key: "carry", title: t(lang, "sec_carry"), icon: "fa-shirt", items: cloth });

    const acts = ACTIVITY_KEYS.map((k) => evaluateActivity(ctx, k, lang, null, true))
      .filter((a) => a.score != null).sort((a, b) => b.score - a.score);
    const sportItems = [];
    acts.slice(0, 3).forEach((a) => {
      sportItems.push(a.name + " — " + a.rating + (a.indoor && a.score < 65 ? " · " + (hi ? "विकल्प: " : "try: ") + a.indoor : ""));
    });
    const avoid = acts.filter((a) => a.ratingKey === "avoid").slice(0, 3).map((a) => a.name);
    if (avoid.length) sportItems.push((hi ? "आज इनसे बचें: " : "Best avoided today: ") + avoid.join(", "));
    if (sportItems.length) secs.push({ key: "sports", title: t(lang, "sec_sports"), icon: "fa-person-running", items: sportItems });

    const f = food(ctx, lang);
    const foodItems = f.foods.slice(0, 5).concat(f.hydration.slice(0, 2));
    if (foodItems.length) secs.push({ key: "food", title: t(lang, "sec_food"), icon: "fa-bowl-food", items: foodItems });

    const w = bestWindow(ctx, lang, null);
    if (w && w.score >= 55) {
      secs.push({
        key: "window", title: t(lang, "sec_window"), icon: "fa-clock",
        items: [(hi ? "बाहर के लिए सबसे आरामदायक: " : "Most comfortable outdoors: ") + w.label + (w.tomorrow ? (hi ? " (कल)" : " (tomorrow)") : "") + " · " + bandLabel(lang, w.band.key)],
      });
    }
    const wl = warnings(ctx, lang);
    if (wl.length) secs.push({ key: "warnings", title: t(lang, "sec_warnings"), icon: "fa-triangle-exclamation", items: wl.map((x) => x.title + " — " + x.text) });
    return secs;
  }

  /* ============================ 15. language ============================ */

  function detectLang(text, pref) {
    if (pref === "en" || pref === "hi") return pref;
    const s = String(text || "");
    if (/[\u0900-\u097F]/.test(s)) return "hi";
    const hinglish = /\b(kya|kaise|kaisa|karna|karu|karun|kare|chahiye|chaiye|mausam|khana|khaana|paani|pani|aaj|kal|jaana|jana|khel|khelna|bahar|andar|kapde|kapda|chhata|chhatta|garmi|sardi|thand|barish|baarish|batao|bata|dikha|hai|hoga|raha|rahe|mera|meri|kab|kahan|kitna|dhup|hawaa|hawa|safai|polish)\b/i.test(s);
    return hinglish ? "hi" : "en";
  }

  /* ============================ 16. NLU / chat ========================== */

  const SPORTS = {
    cricket: ["cricket", "क्रिकेट", "bat", "gully"],
    football: ["football", "soccer", "फुटबॉल"],
    badminton: ["badminton", "बैडमिंटन", "shuttle"],
    running: ["run", "running", "jog", "jogging", "दौड़", "daud", "doud"],
    cycling: ["cycl", "bike", "bicycle", "साइकिल", "cycle"],
    walking: ["walk", "walking", "टहल", "stroll"],
    tennis: ["tennis", "टेनिस"],
    basketball: ["basketball", "बास्केटबॉल"],
    yoga: ["yoga", "योग"],
    swimming: ["swim", "तैर", "pool"],
    hiking: ["trek", "hike", "hiking", "ट्रेक"],
    picnic: ["picnic", "outing", "घूमने", "ghoom"],
    gym: ["gym", "workout", "जिम"],
  };

  function hasAny(s, arr) { return arr.some((k) => s.indexOf(k) >= 0); }
  function detectActivity(s) {
    for (const k in SPORTS) if (hasAny(s, SPORTS[k])) return k;
    return null;
  }
  function detectWhen(s, ctx, lang) {
    const hi = pickLang(lang) === "hi";
    const now = { label: hi ? "अभी" : "now" };
    if (/\b(tomorrow|kal)\b/i.test(s) || s.indexOf("कल") >= 0 || s.indexOf("कल ") >= 0) return { key: "tomorrow", label: hi ? "कल" : "tomorrow" };
    if (/\b(morning|subah|सुबह)\b/i.test(s) || s.indexOf("सुबह") >= 0) return { key: "morning", label: hi ? "सुबह" : "morning" };
    if (/\b(afternoon|dopahar|दोपहर)\b/i.test(s) || s.indexOf("दोपहर") >= 0) return { key: "afternoon", label: hi ? "दोपहर" : "afternoon" };
    if (/\b(evening|shaam|sham|शाम)\b/i.test(s) || s.indexOf("शाम") >= 0) return { key: "evening", label: hi ? "शाम" : "evening" };
    if (/\b(night|raat|रात)\b/i.test(s) || s.indexOf("रात") >= 0) return { key: "night", label: hi ? "रात" : "night" };
    if (/\b(now|abhi|अभी)\b/i.test(s) || s.indexOf("अभी") >= 0) return now;
    return now;
  }
  function timelineForWhen(ctx, whenKey) {
    if (!ctx || !ctx.timeline || !ctx.timeline.length) return [];
    const today = ctx.timeline[0].date;
    const tomorrow = ctx.timeline.find((s) => s.date !== today);
    const tdate = tomorrow ? tomorrow.date : null;
    if (whenKey === "tomorrow") return ctx.timeline.filter((s) => s.date === tdate);
    if (whenKey === "morning") return ctx.timeline.filter((s) => s.date === today && s.hour >= 6 && s.hour <= 11);
    if (whenKey === "afternoon") return ctx.timeline.filter((s) => s.date === today && s.hour >= 12 && s.hour <= 16);
    if (whenKey === "evening") return ctx.timeline.filter((s) => s.date === today && s.hour >= 17 && s.hour <= 21);
    if (whenKey === "night") return ctx.timeline.filter((s) => s.date === today && (s.hour >= 22 || s.hour <= 5));
    return [];
  }

  function answer(question, ctx, lang) {
    const L = pickLang(lang);
    const hi = L === "hi";
    const q = String(question || "").toLowerCase();
    const S = (key, items, icon) => ({ key: key, title: t(lang, "sec_" + key), icon: icon || "fa-circle-info", items: items });
    const out = { intent: "fallback", lang: L, sections: [], followups: [] };

    if (!ctx.available) {
      out.intent = "nodata";
      out.sections = [{ key: "summary", title: t(lang, "sec_summary"), icon: "fa-database", items: [hi ? "अभी मेरे पास मौसम डेटा नहीं है। ऊपर किसी शहर को खोजें या “My Location” दबाएँ, फिर मुझसे फिर पूछें।" : "I don't have weather data yet. Search a city above or tap “My Location”, then ask me again."] }];
      return out;
    }

    // greeting / help / thanks
    if (/^\s*(hi|hey|hello|yo|namaste|namaskar)\b/i.test(q) || /नमस्ते|नमस्कार|हैलो/.test(q)) {
      out.intent = "greeting";
      out.sections = [{ key: "summary", title: hi ? "नमस्ते 👋" : "Hello 👋", icon: "fa-hand-sparkles",
        items: [hi ? "मैं SkyCast असिस्टेंट हूँ। मैं " + ctx.city + " के असली मौसम डेटा से आपकी दिनचर्या की योजना बना सकता हूँ।" : "I'm the SkyCast assistant. I use real weather data for " + ctx.city + " to plan your day.",
          hi ? "पूछिए: क्या साथ ले जाऊँ, क्रिकेट खेल सकता हूँ, क्या खाऊँ, या आज का प्लान।" : "Try: what to carry, can I play cricket, what to eat, or plan my day." ]}];
      return out;
    }
    if (/\b(help|madad|मदद)\b/i.test(q) || s(q).indexOf("what can you do") >= 0 || /क्या कर सकते/.test(q)) {
      out.intent = "help";
      out.sections = [{ key: "actions", title: hi ? "मैं क्या कर सकता हूँ" : "What I can do", icon: "fa-circle-question",
        items: hi ? ["चलने/खेलने का सही समय बताना", "कपड़े और साथ ले जाने वाली चीज़ें", "मौसम के अनुसार खाना और पानी की सलाह", "दिन की योजना और कॉलेज/ऑफ़िस चेकलिस्ट", "कम्फ़र्ट स्कोर और चेतावनियाँ"]
          : ["Best time to walk or play", "Clothes and what to carry", "Weather-based food & hydration tips", "Daily plan and college/office checklist", "Outdoor comfort score and warnings"] }];
      return out;
    }
    if (/thank|thanks|shukriya|dhanyavad|धन्यवाद|शुक्रिया/.test(q)) {
      out.intent = "thanks";
      out.sections = [{ key: "summary", title: hi ? "खुशी हुई" : "You're welcome", icon: "fa-face-smile", items: [hi ? "सुरक्षित रहें!" : "Stay safe out there!"] }];
      return out;
    }

    // activity intent (check early — many questions are about sports)
    const activity = detectActivity(q);
    if (activity) {
      const when = detectWhen(q, ctx, lang);
      const list = timelineForWhen(ctx, when.key);
      let slot = null;
      if (list.length) {
        slot = list.reduce((best, s) => {
          const sc = microScore({ feels: s.feels, humidity: s.humidity, windKmh: s.windKmh, pop: s.pop, precipMm: s.precipMm, precipKind: s.precip, thunder: s.thunder, uv: s.uv, aqi: ctx.aqi ? ctx.aqi.value : null, visKm: s.visKm }, PROFILE.weights).score;
          return (!best || sc > best._sc) ? Object.assign({}, s, { _sc: sc }) : best;
        }, null);
      }
      const a = slot ? evaluateActivity(ctx, activity, lang, slot, true) : evaluateActivity(ctx, activity, lang, null, true);
      out.intent = "activity";
      const items = [];
      items.push(a.name + ": " + a.rating + (a.score != null ? " (" + a.score + "/100)" : ""));
      if (when.key !== "now") items.push((hi ? "समय: " : "Time: ") + when.label + (slot ? " · " + windowLabel(lang, slot) : ""));
      a.tips.forEach((x) => items.push("• " + x));
      if (a.indoor && a.score < 65) items.push((hi ? "इनडोर विकल्प: " : "Indoor option: ") + a.indoor);
      out.sections.push(S("sports", items, "fa-person-running"));
      const w = bestWindow(ctx, lang, activity);
      if (w && w.score >= 55) out.sections.push(S("window", [(hi ? "सबसे अच्छा समय: " : "Best window: ") + w.label + (w.tomorrow ? (hi ? " (कल)" : " (tomorrow)") : "") + " · " + bandLabel(lang, w.band.key)], "fa-clock"));
      const wl = warnings(ctx, lang);
      if (wl.length) out.sections.push(S("warnings", wl.filter((x) => x.level !== "info").map((x) => x.title + " — " + x.text), "fa-triangle-exclamation"));
      out.followups = ["best_time", "carry", "plan"];
      return out;
    }

    // rain / commute
    if (/rain|barish|baarish|umbrella|chhata|chhatta|commute|travel|trip|बारिश|छाता|यात्रा/.test(q)) {
      out.intent = "rain";
      const pop = ctx.nextPop;
      const next = ctx.timeline.find((s) => s.pop != null && s.pop >= 40);
      const items = [];
      if (hi) {
        items.push(pop != null ? "अगले कुछ घंटों में बारिश की संभावना ~" + pop + "% है।" : "बारिश की संभावना कम दिख रही है।");
        if (next) items.push("सबसे ज़्यादा संभावना " + windowLabel(lang, next) + " के आसपास (~" + next.pop + "%)।");
        items.push(pop != null && pop >= 40 ? "छाता या रेनकोट साथ रखें।" : "फिर भी एक हल्का छाता रखना बुरा नहीं।");
      } else {
        items.push(pop != null ? "Rain chance over the next few hours is about " + pop + "%." : "Rain chance looks low right now.");
        if (next) items.push("Peak around " + windowLabel(lang, next) + " (~" + next.pop + "%).");
        items.push(pop != null && pop >= 40 ? "Carry an umbrella or raincoat." : "A compact umbrella is still a safe bet.");
      }
      if (ctx.aqi && ctx.aqi.value >= 4) items.push(hi ? "हवा भी खराब है — बाहर ज़्यादा देर न रहें।" : "Air quality is poor too — limit time outdoors.");
      out.sections.push(S("summary", items, "fa-cloud-rain"));
      out.followups = ["carry", "commute", "plan"];
      return out;
    }

    // food
    if (/\b(eat|food|khana|khaana|meal|lunch|dinner|breakfast|nashta|snack)\b|खाना|खाने|नाश्ता|भोजन/.test(q)) {
      out.intent = "food";
      const f = food(ctx, lang);
      out.sections.push(S("food", f.foods, "fa-bowl-food"));
      out.sections.push(S("actions", f.hydration, "fa-glass-water"));
      out.followups = ["hydration", "plan", "carry"];
      return out;
    }

    // hydration
    if (/water|paani|pani|hydrat|drink|पानी|प्यास/.test(q)) {
      out.intent = "hydration";
      const f = food(ctx, lang);
      out.sections.push(S("food", f.hydration, "fa-glass-water"));
      out.followups = ["food", "activity", "plan"];
      return out;
    }

    // heat protection
    if (/\b(heat|hot)\b|garmi|गर्मी|heatstroke|garmi se|protect.*sun|लू/.test(q)) {
      out.intent = "heat";
      const feels = ctx.now.feels != null ? ctx.now.feels : ctx.now.temp;
      const items = hi
        ? ["दोपहर 12–4 बजे बाहर के काम टालें या छाया चुनें।", "हल्के, ढीले सूती कपड़े पहनें।", "पानी/छाछ हर थोड़ी देर में पिएँ, नारियल पानी अच्छा है।", "सिर ढकें (कैप/गमछा) और चक्कर, ऐंठन या उल्टी होने पर तुरंत ठंडी जगह जाएँ।"]
        : ["Avoid outdoor work from 12–4 PM or stay in shade.", "Wear light, loose cotton clothes.", "Sip water/buttermilk often; coconut water helps.", "Cover your head (cap/cloth); if you feel dizzy, cramped or nauseous, get to a cool place immediately."];
      if (feels != null) items.unshift((hi ? "महसूस हो रहा है ~" : "It feels like ~") + Math.round(feels) + "°C.");
      out.sections.push(S("actions", items, "fa-temperature-high"));
      const wl = warnings(ctx, lang).filter((x) => x.key === "w_heat" || x.key === "w_uv");
      if (wl.length) out.sections.push(S("warnings", wl.map((x) => x.title + " — " + x.text), "fa-triangle-exclamation"));
      out.followups = ["hydration", "food", "plan"];
      return out;
    }

    // UV / sun
    if (/\buv\b|sunscreen|sun|sunlight|धूप|यूवी|dhoop/.test(q)) {
      out.intent = "uv";
      const uv = ctx.uv;
      const items = [];
      if (uv == null) items.push(hi ? "यूवी डेटा अभी उपलब्ध नहीं है। सुरक्षित रहें: दोपहर में छाया लें और टोपी पहनें।" : "UV data is not available right now. To be safe, seek shade at midday and wear a cap.");
      else {
        items.push((hi ? "अभी यूवी इंडेक्स " : "Current UV index is ") + Math.round(uv) + (uv >= 8 ? (hi ? " — काफ़ी तेज़।" : " — quite high.") : uv >= 6 ? (hi ? " — अधिक।" : " — high.") : uv >= 3 ? (hi ? " — मध्यम।" : " — moderate.") : (hi ? " — कम।" : " — low.")));
        items.push(hi ? "सनस्क्रीन (SPF 30+), धूप का चश्मा और कैप इस्तेमाल करें।" : "Use sunscreen (SPF 30+), sunglasses and a cap.");
        items.push(hi ? "11 बजे से 4 बजे तक छाया में सबसे ज़्यादा यूवी होता है।" : "UV peaks roughly between 11 AM and 4 PM.");
      }
      out.sections.push(S("actions", items, "fa-sun"));
      out.followups = ["carry", "heat", "plan"];
      return out;
    }

    // wind
    if (/wind|hawa|hawaa|हवा|आंधी|storm|thunder|बिजली/.test(q)) {
      out.intent = "wind";
      const items = [];
      if (ctx.now.windKmh != null) items.push((hi ? "हवा की रफ़्तार ~" : "Wind speed is ~") + Math.round(ctx.now.windKmh) + (hi ? " किमी/घं" : " km/h") + (ctx.now.windDir ? " (" + ctx.now.windDir + ")" : "") + ".");
      if (ctx.now.gustKmh != null) items.push((hi ? "झोंके ~" : "Gusts up to ~") + Math.round(ctx.now.gustKmh) + (hi ? " किमी/घं तक।" : " km/h."));
      items.push(hi ? "तेज़ हवा में साइकिल/दोपहिया और छाता सँभलकर।" : "In strong wind, be careful with cycling, two-wheelers and umbrellas.");
      out.sections.push(S("summary", items, "fa-wind"));
      const wl = warnings(ctx, lang).filter((x) => x.key === "w_tstorm" || x.key === "w_wind" || x.key === "w_squall");
      if (wl.length) out.sections.push(S("warnings", wl.map((x) => x.title + " — " + x.text), "fa-triangle-exclamation"));
      out.followups = ["activity", "plan", "carry"];
      return out;
    }

    // AQI
    if (/aqi|air quality|pollution|pm2|smog|pradushan|हवा की गुणवत्ता|प्रदूषण/.test(q)) {
      out.intent = "aqi";
      const items = [];
      if (!ctx.aqi) items.push(hi ? "इस शहर के लिए वायु गुणवत्ता डेटा उपलब्ध नहीं है।" : "Air quality data is not available for this city.");
      else {
        items.push((hi ? "वायु गुणवत्ता: " : "Air quality: ") + t(lang, "aq_" + ctx.aqi.value) + " (OpenWeatherMap " + ctx.aqi.value + "/5).");
        if (ctx.aqi.pm25 != null) items.push("PM2.5: " + round(ctx.aqi.pm25, 1) + " µg/m³" + (ctx.aqi.pm10 != null ? " · PM10: " + round(ctx.aqi.pm10, 1) + " µg/m³" : ""));
        items.push(ctx.aqi.value >= 4 ? (hi ? "बाहर व्यायाम से बचें, मास्क पहनें।" : "Avoid outdoor workouts and wear a mask.") : (hi ? "सामान्य गतिविधि ठीक है।" : "Normal activity is fine."));
        items.push(hi ? "यह OpenWeatherMap का 1–5 संकेतक है, आधिकारिक AQI नहीं।" : "This is the OpenWeatherMap 1–5 indicator, not an official AQI value.");
      }
      out.sections.push(S("summary", items, "fa-lungs"));
      out.followups = ["activity", "plan", "carry"];
      return out;
    }

    // comfort score
    if (/comfort|score|आराम|कम्फ/.test(q)) {
      out.intent = "comfort";
      const a = assess(ctx, lang);
      out.sections.push(S("summary", [a.score + "/100 — " + a.band.label, a.disclaimer], "fa-gauge-high"));
      const top = a.factors.filter((f) => f.available && f.deduction > 0).sort((x, y) => y.deduction - x.deduction).slice(0, 4);
      if (top.length) out.sections.push(S("actions", top.map((f) => f.detail + " (−" + f.deduction + ")"), "fa-sliders"));
      out.followups = ["activity", "plan", "warnings"];
      return out;
    }

    // carry / clothing (checked before plan so "carry today?" stays on-topic)
    if (/\b(carry|wear|clothes|dress|jacket|umbrella|sunscreen|kapde|kapda|chhata)\b|कपड़े|छाता|पहन|साथ/.test(q)) {
      out.intent = "carry";
      out.sections.push(S("carry", clothing(ctx, lang), "fa-shirt"));
      out.followups = ["activity", "food", "plan"];
      return out;
    }

    // plan / briefing (explicit planner words only — bare time words like
    // "today"/"aaj" must NOT hijack carry/activity/window questions)
    if (/\b(plan|plans|planned|planning|brief|briefing|schedule|routine|itinerary|roster)\b|योजना|प्लान|ब्रीफ़िंग|ब्रीफिंग|दिनचर्या|डेली|दिन-भर|दिन भर|दिन का/.test(q)) {
      const when = detectWhen(q, ctx, lang);
      out.intent = "plan";
      const secs = briefingSections(ctx, lang);
      out.sections = secs.filter((s) => ["summary", "actions", "carry", "window", "warnings"].indexOf(s.key) >= 0);
      const p = planner(ctx, lang);
      if (p.periods.length) out.sections.unshift({ key: "summary", title: hi ? "दिन का पैटर्न" : "Day pattern", icon: "fa-calendar-day",
        items: p.periods.map((x) => x.name + ": " + (x.tMin != null ? x.tMin + "–" + x.tMax + "°C" : "") + (x.pop != null ? ", " + (hi ? "बारिश " : "rain ") + x.pop + "%" : "") + " · " + x.verdict) });
      out.followups = ["activity", "carry", "food"];
      return out;
    }

    // best time
    if (/best time|when should|when can|when.*go|kab|समय|कब|सबसे अच्छा/.test(q)) {
      out.intent = "window";
      const w = bestWindow(ctx, lang, null);
      const items = [];
      if (w && w.score >= 55) items.push((hi ? "सबसे आरामदायक समय: " : "Most comfortable window: ") + w.label + (w.tomorrow ? (hi ? " (कल)" : " (tomorrow)") : "") + " · " + bandLabel(lang, w.band.key) + (w.slot && w.slot.feels != null ? " · " + (hi ? "महसूस " : "feels ") + Math.round(w.slot.feels) + "°C" : ""));
      else items.push(hi ? "आज बाहर के लिए कोई बहुत अच्छा समय नहीं दिख रहा — इनडोर योजना बनाएँ।" : "No great outdoor window today — plan something indoors.");
      const p = planner(ctx, lang);
      p.windows.forEach((x) => items.push((hi ? x.activity + " के लिए: " : x.activity + ": ") + x.label + " · " + x.band));
      out.sections.push(S("window", items, "fa-clock"));
      out.followups = ["activity", "plan", "carry"];
      return out;
    }

    // temperature / feels / humidity quick facts
    if (/temperature|temp|kitna|thand|sardi|garmi|humidity|nami|तापमान|नमी|उमस/.test(q)) {
      out.intent = "facts";
      const items = [summaryLine(ctx, lang)];
      if (ctx.now.dewPoint != null) items.push((hi ? "ड्यू पॉइंट ~" : "Dew point ~") + Math.round(ctx.now.dewPoint) + "°C" + (ctx.now.dewPoint >= 24 ? (hi ? " (उमस भरा)" : " (muggy)") : ""));
      if (ctx.now.heatIndex != null) items.push((hi ? "अनुमानित हीट इंडेक्स ~" : "Estimated heat index ~") + Math.round(ctx.now.heatIndex) + "°C");
      out.sections.push(S("summary", items, "fa-temperature-half"));
      out.followups = ["carry", "activity", "plan"];
      return out;
    }

    // sunrise / sunset
    if (/sunrise|sunset|suraj|सूरज|सूर्योदय|सूर्यास्त/.test(q)) {
      out.intent = "sun";
      const items = [];
      if (ctx.now.sunrise != null) items.push((hi ? "सूर्योदय: " : "Sunrise: ") + clock(ctx, ctx.now.sunrise));
      if (ctx.now.sunset != null) items.push((hi ? "सूर्यास्त: " : "Sunset: ") + clock(ctx, ctx.now.sunset));
      if (!items.length) items.push(hi ? "यह जानकारी उपलब्ध नहीं है।" : "That information is unavailable.");
      out.sections.push(S("summary", items, "fa-sun"));
      out.followups = ["activity", "plan", "uv"];
      return out;
    }

    // generic weather summary fallback
    out.intent = "summary";
    out.sections = briefingSections(ctx, lang).filter((s) => ["summary", "actions", "window", "warnings"].indexOf(s.key) >= 0);
    out.followups = ["activity", "carry", "food", "plan"];
    return out;
  }
  function s(x) { return String(x || "").toLowerCase(); }
  function clock(ctx, epochSec) {
    if (epochSec == null) return "";
    const d = new Date((epochSec + (ctx.tz || 0)) * 1000);
    let h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const ampm = h < 12 ? "AM" : "PM";
    h = h % 12 === 0 ? 12 : h % 12;
    return h + ":" + (m < 10 ? "0" + m : m) + " " + ampm;
  }

  /* ============================ 17. suggested Qs ======================== */

  const SUGGESTED = [
    { id: "carry", en: "What should I carry today?", hi: "आज मुझे क्या साथ ले जाना चाहिए?" },
    { id: "cricket", en: "Can I play cricket this evening?", hi: "क्या मैं आज शाम क्रिकेट खेल सकता हूँ?" },
    { id: "running", en: "Is it a good time to go running?", hi: "क्या दौड़ने का अच्छा समय है?" },
    { id: "food", en: "What should I eat in this hot weather?", hi: "इस गर्मी में मैं क्या खाऊँ?" },
    { id: "commute", en: "Will it rain during my commute?", hi: "क्या मेरी यात्रा के दौरान बारिश होगी?" },
    { id: "heat", en: "How can I protect myself from today's heat?", hi: "आज की गर्मी से मैं कैसे बचूँ?" },
    { id: "tomorrowPlan", en: "Plan my outdoor activities for tomorrow", hi: "कल के लिए मेरी बाहरी गतिविधियाँ प्लान करें" },
    { id: "comfort", en: "What is today's outdoor comfort score?", hi: "आज का outdoor comfort score क्या है?" },
    { id: "plan", en: "Give me today's daily briefing", hi: "आज का डेली ब्रीफ़िंग दें" },
  ];

  /* ============================ 18. export ============================== */

  const AI = {
    version: VERSION,
    STR: STR,
    ACTIVITIES: ACTIVITIES,
    ACTIVITY_KEYS: ACTIVITY_KEYS,
    SUGGESTED: SUGGESTED,
    t: t,
    detectLang: detectLang,
    classify: classify,
    condLabel: condLabel,
    buildContext: buildContext,
    assess: assess,
    comfort: assess,
    clothing: clothing,
    activities: function (ctx, lang) {
      return ACTIVITY_KEYS.map((k) => evaluateActivity(ctx, k, lang, null, true))
        .filter((a) => a.score != null).sort((a, b) => b.score - a.score);
    },
    activityAdvice: evaluateActivity,
    bestWindow: bestWindow,
    food: food,
    planner: planner,
    warnings: warnings,
    summary: summaryLine,
    actions: actions,
    briefingSections: briefingSections,
    answer: answer,
    clock: clock,
    // exposed for testing / transparency
    _internal: { microScore: microScore, heatIndexC: heatIndexC, windChillC: windChillC, dewPointC: dewPointC, bandOf: bandOf },
  };

  global.SkyCastAI = AI;
})(typeof window !== "undefined" ? window : this);
