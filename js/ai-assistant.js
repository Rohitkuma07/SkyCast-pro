/* ============================================================================
   SkyCast Pro — AI Weather Lifestyle Assistant (UI layer)
   ----------------------------------------------------------------------------
   Wires the reasoning engine (js/ai-engine.js) to the dashboard.
   • Reuses the existing weather data via window.SkyCastData (published by
     js/api.js) — no duplicate weather API integration.
   • Answers are generated locally from real weather data by default.
   • Optionally forwards questions to a SECURE backend that holds the AI key.
     If no backend is configured, it silently falls back to the local engine.
   • Requests are cached and rate-limited.
   ============================================================================ */
(function () {
  "use strict";

  /* ----------------------------- configuration ---------------------------- */
  // Set `backendUrl` to your deployed AI proxy (see backend/README.md).
  // NEVER put an AI API key here — it belongs on the server.
  var DEFAULT_CONFIG = {
    backendUrl: "",                     // e.g. "https://your-app.vercel.app/api/ai"
    defaultCity: "New Delhi",           // used only when nothing is loaded yet
    enableAutoLoad: true,               // load default/last city on first visit
    language: "auto",                   // "auto" | "en" | "hi"
    minSendIntervalMs: 700,             // client-side rate limit
    backendTimeoutMs: 12000,
    cacheLimit: 60,
  };

  function getConfig() {
    var cfg = Object.assign({}, DEFAULT_CONFIG, window.SKYCAST_AI_CONFIG || {});
    try {
      var saved = localStorage.getItem("skycast_ai_backend");
      if (saved) cfg.backendUrl = saved;
      var savedLang = localStorage.getItem("skycast_ai_lang");
      if (savedLang) cfg.language = savedLang;
    } catch (e) { /* storage blocked — ignore */ }
    return cfg;
  }

  var AI = window.SkyCastAI;

  /* ------------------------------- utilities ------------------------------ */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function iconFor(tone) {
    if (tone === "bad") return "fa-circle-exclamation";
    if (tone === "warn") return "fa-triangle-exclamation";
    return "fa-circle-check";
  }

  /* ------------------------------- state ---------------------------------- */
  var els = {};
  var state = {
    mode: "loading",        // loading | empty | error | ready
    ctx: null,
    uiLang: "auto",
    lastDetected: "en",
    lastSend: 0,
    cache: new Map(),
    greetedCity: null,
    backendWorking: null,   // null=unknown, true, false
  };

  function effectiveLang() {
    if (state.uiLang === "en" || state.uiLang === "hi") return state.uiLang;
    return state.lastDetected || "en";
  }

  /* ------------------------------- boot ----------------------------------- */
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var root = $("ai-assistant");
    if (!root || !AI) return; // assistant markup / engine not present — do nothing

    els.root = root;
    els.greeting = $("aiGreeting");
    els.subtitle = $("aiSubtitle");
    els.sourceNote = $("aiSourceNote");
    els.stateBox = $("aiState");
    els.stateIcon = $("aiStateIcon");
    els.stateTitle = $("aiStateTitle");
    els.stateText = $("aiStateText");
    els.stateActions = $("aiStateActions");
    els.content = $("aiContent");
    els.comfort = $("aiComfort");
    els.grid = $("aiGrid");
    els.planner = $("aiPlanner");
    els.warnings = $("aiWarnings");
    els.log = $("aiChatLog");
    els.suggest = $("aiSuggest");
    els.form = $("aiForm");
    els.input = $("aiInput");
    els.send = $("aiSend");
    els.mic = $("aiMic");
    els.lang = $("aiLang");
    els.refresh = $("aiRefresh");
    els.chatHint = $("aiChatHint");
    els.launcher = $("aiLauncher");

    var cfg = getConfig();
    state.uiLang = cfg.language || "auto";
    if (els.lang) els.lang.value = state.uiLang;

    bindEvents();
    setupVoice();
    renderSuggestions();
    renderChatHint();

    // reuse existing weather data if it is already loaded
    if (window.SkyCastData && window.SkyCastData.current) onData();
    else setState("loading");

    window.addEventListener("skycast:update", onData);
    window.addEventListener("skycast:error", function (e) {
      if (!(window.SkyCastData && window.SkyCastData.current)) {
        setState("error", (e && e.detail && e.detail.message) || null);
      }
    });

    maybeAutoLoad(cfg);
  });

  function maybeAutoLoad(cfg) {
    if (!cfg.enableAutoLoad) { setState("empty"); return; }
    if (window.SkyCastData && window.SkyCastData.current) return;
    if (typeof window.getWeather !== "function") { setState("empty"); return; }
    // sleep briefly so the rest of the dashboard is interactive first
    setTimeout(function () {
      if (window.SkyCastData && window.SkyCastData.current) return;
      var city = cfg.defaultCity;
      try { city = localStorage.getItem("skycast_last_city") || cfg.defaultCity; } catch (e) {}
      try { window.getWeather(city); } catch (e) { setState("empty"); }
    }, 400);
  }

  /* ------------------------------- events --------------------------------- */
  function bindEvents() {
    if (els.lang) els.lang.addEventListener("change", function () {
      state.uiLang = els.lang.value;
      try { localStorage.setItem("skycast_ai_lang", state.uiLang); } catch (e) {}
      renderChatHint();
      if (state.ctx && state.ctx.available) { renderAll(state.ctx); renderSuggestions(); }
    });

    if (els.refresh) els.refresh.addEventListener("click", function () {
      els.refresh.classList.add("ai-spin");
      setTimeout(function () { els.refresh.classList.remove("ai-spin"); }, 900);
      var d = window.SkyCastData;
      if (d && d.current && typeof window.getEnv === "function" && d.current.coord) {
        window.getEnv(d.current.coord.lat, d.current.coord.lon);
      } else if (typeof window.getWeather === "function" && d && d.current) {
        window.getWeather(d.current.name);
      } else if (typeof window.getWeather === "function") {
        window.getWeather(getConfig().defaultCity);
      }
      if (state.ctx && state.ctx.available) renderAll(state.ctx);
    });

    if (els.form) els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      submit(els.input.value);
    });

    document.querySelectorAll("[data-ai-ask]").forEach(function (b) {
      b.addEventListener("click", function () { submit(b.getAttribute("data-ai-ask")); });
    });

    // empty-state buttons
    if (els.stateActions) els.stateActions.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ai-action]");
      if (!b) return;
      var act = b.getAttribute("data-ai-action");
      if (act === "location" && $("locationBtn")) $("locationBtn").click();
      else if (act === "default" && typeof window.getWeather === "function") window.getWeather(getConfig().defaultCity);
      else if (act === "search" && $("cityInput")) {
        $("cityInput").scrollIntoView({ behavior: "smooth", block: "center" });
        $("cityInput").focus();
      }
    });

    if (els.launcher) els.launcher.addEventListener("click", function () {
      var sec = $("ai-assistant");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(function () { if (els.input) els.input.focus(); }, 500);
    });

    // scroll-to targets for nav links / footer links
    document.querySelectorAll('a[href="#ai-assistant"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var sec = $("ai-assistant");
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  /* ------------------------------- data ----------------------------------- */
  function onData() {
    var ctx = AI.buildContext(window.SkyCastData);
    state.ctx = ctx;
    if (!ctx.available) { setState("empty"); return; }
    setState("ready");
    renderAll(ctx);
    if (state.greetedCity !== ctx.city) {
      state.greetedCity = ctx.city;
      postGreeting(ctx);
    }
  }

  function setState(mode, msg) {
    if (!els.stateBox) return;
    state.mode = mode;
    els.content.classList.toggle("ai-show", mode === "ready");
    els.stateBox.classList.toggle("ai-show", mode !== "ready");
    els.stateBox.classList.remove("ai-error");
    if (mode === "ready") return;

    if (mode === "loading") {
      els.stateIcon.className = "fa-solid fa-spinner fa-spin";
      els.stateTitle.textContent = "Loading live weather…";
      els.stateText.textContent = "Fetching the latest conditions to prepare your lifestyle briefing.";
      els.stateActions.innerHTML = "";
    } else if (mode === "empty") {
      els.stateIcon.className = "fa-solid fa-location-crosshairs";
      els.stateTitle.textContent = "Let's get your weather first";
      els.stateText.textContent = "Search a city above, tap “My Location”, or load a default city — then the assistant can plan your day using real data.";
      els.stateActions.innerHTML =
        '<button class="ai-btn" data-ai-action="location"><i class="fa-solid fa-location-dot"></i> Use my location</button>' +
        '<button class="ai-btn ai-btn-ghost" data-ai-action="default"><i class="fa-solid fa-cloud-sun"></i> Load ' + esc(getConfig().defaultCity) + '</button>' +
        '<button class="ai-btn ai-btn-ghost" data-ai-action="search"><i class="fa-solid fa-magnifying-glass"></i> Search a city</button>';
    } else if (mode === "error") {
      els.stateBox.classList.add("ai-error");
      els.stateIcon.className = "fa-solid fa-cloud-bolt";
      els.stateTitle.textContent = "Weather data unavailable";
      els.stateText.textContent = msg || "We couldn't reach the weather service. Check your connection or API key, then retry.";
      els.stateActions.innerHTML =
        '<button class="ai-btn" data-ai-action="default"><i class="fa-solid fa-rotate-right"></i> Retry</button>' +
        '<button class="ai-btn ai-btn-ghost" data-ai-action="search"><i class="fa-solid fa-magnifying-glass"></i> Try another city</button>';
    }
  }

  /* ------------------------------- render --------------------------------- */
  function renderAll(ctx) {
    var lang = effectiveLang();
    if (els.greeting) {
      var hour = new Date().getHours();
      var g = hour < 12 ? (lang === "hi" ? "सुप्रभात" : "Good morning")
        : hour < 17 ? (lang === "hi" ? "नमस्ते" : "Good afternoon")
          : (lang === "hi" ? "शुभ संध्या" : "Good evening");
      els.greeting.textContent = g + " 👋";
    }
    if (els.subtitle) els.subtitle.textContent = AI.summary(ctx, lang);
    renderSources(ctx);
    renderComfort(ctx, lang);
    renderGrid(ctx, lang);
    renderPlanner(ctx, lang);
    renderWarnings(ctx, lang);
  }

  function renderSources(ctx) {
    if (!els.sourceNote) return;
    var b = [];
    b.push('<span class="ai-src-badge"><i class="fa-solid fa-satellite-dish"></i> Weather: ' + esc(ctx.sources.weather) + "</span>");
    if (ctx.sources.env) b.push('<span class="ai-src-badge"><i class="fa-solid fa-sun"></i> UV & hourly: ' + esc(ctx.sources.env) + "</span>");
    if (ctx.sources.aqi) b.push('<span class="ai-src-badge"><i class="fa-solid fa-wind"></i> Air quality: ' + esc(ctx.sources.aqi) + "</span>");
    var t = new Date(ctx.updatedAt);
    b.push('<span class="ai-src-badge"><i class="fa-solid fa-location-dot"></i> ' + esc(ctx.city) + ' local time ' + esc(AI.clock(ctx, Math.floor(Date.now() / 1000))) + "</span>");
    b.push('<span class="ai-src-badge"><i class="fa-regular fa-clock"></i> Updated ' + esc(t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) + "</span>");
    b.push('<span class="ai-src-badge"><i class="fa-solid fa-microchip"></i> ' + (backendEnabled() ? "AI model + live data" : "Live-data recommendations") + "</span>");
    els.sourceNote.innerHTML = b.join("");
  }

  function renderComfort(ctx, lang) {
    if (!els.comfort) return;
    var a = AI.assess(ctx, lang);
    if (!a.available) { els.comfort.innerHTML = ""; return; }
    var color = a.band.tone === "bad" ? "var(--ai-bad)" : a.band.tone === "warn" ? "var(--ai-warn)" : "var(--ai-good)";
    var factors = a.factors.map(function (f) {
      var tone = f.available ? (f.tone === "muted" ? "ai-muted" : "") : "ai-muted";
      var badness = f.available ? Math.min(100, Math.round((f.penalty || 0))) : 0;
      var barTone = f.available ? (f.tone === "bad" ? "ai-bad" : f.tone === "warn" ? "ai-warn" : "") : "";
      return '<div class="ai-factor ' + tone + '">' +
        '<span class="ai-factor-name">' + esc(f.label) + "</span>" +
        '<span class="ai-factor-val">' + esc(f.available ? f.detail : AI.t(lang, "unknown")) + (f.available && f.deduction > 0 ? " · −" + f.deduction : "") + "</span>" +
        '<div class="ai-bar ' + barTone + '"><span style="width:' + badness + '%"></span></div>' +
        "</div>";
    }).join("");

    var good = a.goodActivities && a.goodActivities.length
      ? (lang === "hi" ? "अभी के लिए अच्छा: " : "Looks good for: ") + a.goodActivities.join(", ")
      : (lang === "hi" ? "बाहर के लिए ज़्यादा आदर्श नहीं" : "Not particularly ideal outdoors right now");

    els.comfort.innerHTML =
      '<div class="ai-card ai-card-wide">' +
        '<div class="ai-card-head">' +
          '<div class="ai-card-icon"><i class="fa-solid fa-gauge-high"></i></div>' +
          "<div><h3>" + (lang === "hi" ? "आउटडोर कम्फ़र्ट स्कोर" : "Outdoor comfort score") + "</h3>" +
          "<p>" + (lang === "hi" ? "मौसम व पर्यावरण कारकों पर आधारित" : "Based on weather & environmental factors") + "</p></div>" +
        "</div>" +
        '<div class="ai-comfort">' +
          '<div class="ai-dial" style="--pct:' + a.score + ";--dial-color:" + color + '">' +
            '<div class="ai-dial-inner"><div class="ai-dial-score">' + a.score + '</div><div class="ai-dial-max">/ 100</div>' +
            '<div class="ai-dial-band" style="color:' + color + '">' + esc(a.band.label) + "</div></div>" +
          "</div>" +
          '<div class="ai-comfort-side">' +
            '<div class="ai-comfort-headline">' + esc(good) + "</div>" +
            '<div class="ai-factors">' + factors + "</div>" +
            '<div class="ai-disclaimer">' + esc(a.disclaimer) + "</div>" +
          "</div>" +
        "</div>" +
      "</div>";
  }

  function card(icon, title, sub, body, wide) {
    return '<div class="ai-card' + (wide ? " ai-card-wide" : "") + '">' +
      '<div class="ai-card-head"><div class="ai-card-icon"><i class="fa-solid ' + icon + '"></i></div>' +
      "<div><h3>" + esc(title) + "</h3><p>" + esc(sub || "") + "</p></div></div>" + body + "</div>";
  }
  function list(items, ic) {
    return '<ul class="ai-list">' + items.map(function (x) {
      return "<li><i class=\"fa-solid " + (ic || "fa-circle-check") + "\"></i><span>" + esc(x) + "</span></li>";
    }).join("") + "</ul>";
  }

  function renderGrid(ctx, lang) {
    if (!els.grid) return;
    var hi = lang === "hi";
    var html = "";

    // clothing
    var cloth = AI.clothing(ctx, lang);
    html += card("fa-shirt", hi ? "कपड़े और साथ ले जाएँ" : "Clothing & what to carry",
      hi ? "तापमान, बारिश, हवा, यूवी के अनुसार" : "Based on temperature, rain, wind & UV",
      list(cloth, "fa-bag-shopping"));

    // activities
    var acts = AI.activities(ctx, lang).slice(0, 6);
    var rows = acts.map(function (a) {
      var tip = a.tips.slice(0, 2).join(" · ") || (a.indoor && a.score < 65 ? (hi ? "इनडोर विकल्प: " : "Indoor: ") + a.indoor : "");
      return '<div class="ai-act-row">' +
        '<span class="ai-act-name">' + esc(a.name) + "</span>" +
        '<span class="ai-act-tip">' + esc(tip) + '</span>' +
        '<span class="ai-chip ai-' + (a.tone === "good" ? "good" : a.tone === "warn" ? "warn" : "bad") + '">' + esc(a.rating) + "</span>" +
        "</div>";
    }).join("");
    html += card("fa-person-running", hi ? "खेल और गतिविधि" : "Sports & activities",
      hi ? "तापमान, नमी, हवा, बारिश, AQI" : "Temperature, humidity, wind, rain & AQI", '<div class="ai-act">' + rows + "</div>");

    // food
    var f = AI.food(ctx, lang);
    html += card("fa-bowl-food", hi ? "मौसम के अनुसार खाना" : "Weather-smart food",
      hi ? "भारतीय विकल्प" : "Indian suggestions", list(f.foods, "fa-utensils"));

    // hydration
    html += card("fa-glass-water", hi ? "हाइड्रेशन" : "Hydration",
      hi ? "मात्रा व्यक्ति के अनुसार बदलती है" : "Needs vary per person",
      list(f.hydration, "fa-droplet"));

    els.grid.innerHTML = html;
  }

  function renderPlanner(ctx, lang) {
    if (!els.planner) return;
    var hi = lang === "hi";
    var p = AI.planner(ctx, lang);
    var body = "";

    if (p.periods.length) {
      body += '<div class="ai-periods">' + p.periods.map(function (x) {
        var meta = (x.tMin != null ? x.tMin + "–" + x.tMax + "°C" : "") +
          (x.feelsMax != null ? " · " + (hi ? "महसूस " : "feels ") + x.feelsMax + "°C" : "") +
          (x.pop != null ? " · " + (hi ? "बारिश " : "rain ") + x.pop + "%" : "");
        return '<div class="ai-period"><b>' + esc(x.name) + "</b><span class=\"ai-period-meta\">" + esc(meta) + "<br>" + esc(x.verdict) + "</span></div>";
      }).join("") + "</div>";
    }

    if (p.windows.length) {
      body += '<div class="ai-act" style="margin-bottom:16px">' + p.windows.map(function (w) {
        return '<div class="ai-act-row"><span class="ai-act-name">' + esc(w.activity) + "</span>" +
          '<span class="ai-act-tip">' + esc(w.label + (w.tomorrow ? (hi ? " (कल)" : " (tomorrow)") : "")) + "</span>" +
          '<span class="ai-chip ai-' + (w.tone === "good" ? "good" : w.tone === "warn" ? "warn" : "bad") + '">' + esc(w.band) + "</span></div>";
      }).join("") + "</div>";
    }

    body += '<div class="ai-card-head" style="margin-bottom:10px"><div class="ai-card-icon"><i class="fa-solid fa-list-check"></i></div>' +
      "<div><h3>" + (hi ? "कॉलेज / ऑफ़िस चेकलिस्ट" : "College / office checklist") + "</h3></div></div>";
    body += list(p.checklist, "fa-check");

    if (p.indoor.length) {
      body += '<div class="ai-card-head" style="margin:18px 0 10px"><div class="ai-card-icon"><i class="fa-solid fa-house"></i></div>' +
        "<div><h3>" + (hi ? "इनडोर विकल्प" : "Indoor alternatives") + "</h3></div></div>";
      body += list(p.indoor.map(function (x) { return x.activity + " → " + x.alternative; }), "fa-house-chimney");
    }

    els.planner.innerHTML = card("fa-calendar-day", hi ? "स्मार्ट डेली प्लानर" : "Smart daily planner",
      hi ? "सुबह, दोपहर, शाम की तुलना" : "Morning vs afternoon vs evening", body, true);
  }

  function renderWarnings(ctx, lang) {
    if (!els.warnings) return;
    var w = AI.warnings(ctx, lang);
    w.push({ level: "info", title: lang === "hi" ? "आधिकारिक अलर्ट" : "Official alerts", text: AI.t(lang, "alerts_unavailable") });
    var body = '<div class="ai-warn-list">' + w.map(function (x) {
      return '<div class="ai-warn-item ai-' + esc(x.level) + '"><i class="fa-solid ' +
        (x.level === "danger" ? "fa-triangle-exclamation" : x.level === "warning" ? "fa-circle-exclamation" : "fa-circle-info") +
        '"></i><div><b>' + esc(x.title) + "</b><br>" + esc(x.text) + "</div></div>";
    }).join("") + "</div>";
    els.warnings.innerHTML = card("fa-shield-halved", lang === "hi" ? "चेतावनी और सुरक्षा" : "Warnings & safety",
      lang === "hi" ? "गंभीर मौसम, गर्मी, हवा" : "Severe weather, heat & air", body, true);
  }

  /* ------------------------------- suggestions ---------------------------- */
  function renderSuggestions() {
    if (!els.suggest) return;
    var lang = effectiveLang();
    els.suggest.innerHTML = AI.SUGGESTED.map(function (q) {
      var text = lang === "hi" ? q.hi : q.en;
      return '<button type="button" data-ai-ask="' + esc(text) + '">' + esc(text) + "</button>";
    }).join("");
    els.suggest.querySelectorAll("[data-ai-ask]").forEach(function (b) {
      b.addEventListener("click", function () { submit(b.getAttribute("data-ai-ask")); });
    });
  }

  function renderChatHint() {
    if (!els.chatHint) return;
    var lang = effectiveLang();
    var mode = backendEnabled()
      ? (lang === "hi" ? "AI मॉडल + लाइव डेटा" : "AI model + live data")
      : (lang === "hi" ? "लाइव-डेटा नियम" : "Live-data engine");
    els.chatHint.innerHTML = '<span class="ai-mode"><i class="fa-solid fa-microchip"></i>' + esc(mode) + "</span>" +
      (lang === "hi"
        ? "जवाब वर्तमान मौसम, पूर्वानुमान, यूवी और AQI पर आधारित हैं — कोई डेटा मिलने पर ही सलाह दी जाती है। चिकित्सीय सलाह नहीं।"
        : "Answers use current weather, forecast, UV and AQI. Guidance only — not medical advice.");
  }

  /* --------------------------------- chat --------------------------------- */
  function bubbleHTML(sections, tag) {
    return sections.map(function (sec) {
      return '<div class="ai-bubble-sec">' +
        '<div class="ai-bubble-title"><i class="fa-solid ' + esc(sec.icon || "fa-circle-info") + '"></i>' + esc(sec.title) + "</div>" +
        "<ul>" + sec.items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>" +
        "</div>";
    }).join("") + (tag ? '<div class="ai-tag">' + esc(tag) + "</div>" : "");
  }

  function appendMsg(role, html, tag) {
    if (!els.log) return;
    var wrap = document.createElement("div");
    wrap.className = "ai-msg ai-" + role;
    wrap.innerHTML =
      '<div class="ai-msg-avatar"><i class="fa-solid ' + (role === "user" ? "fa-user" : "fa-robot") + '"></i></div>' +
      '<div class="ai-bubble">' + html + (tag ? '<div class="ai-tag">' + esc(tag) + "</div>" : "") + "</div>";
    els.log.appendChild(wrap);
    els.log.scrollTop = els.log.scrollHeight;
    return wrap;
  }

  function postGreeting(ctx) {
    if (!els.log) return;
    var lang = effectiveLang();
    var items = [];
    if (lang === "hi") {
      items.push("मैं " + ctx.city + " के असली मौसम डेटा से आपका दिन प्लान कर सकता हूँ।");
      items.push("नीचे से कोई सवाल चुनें या अपना लिखें — जैसे “आज क्या पहनूँ?”");
    } else {
      items.push("I can plan your day using live weather data for " + ctx.city + ".");
      items.push("Tap a suggestion below or type your own — e.g. “what should I wear today?”");
    }
    appendMsg("bot", bubbleHTML([{ title: lang === "hi" ? "नमस्ते!" : "Hi there!", icon: "fa-hand-sparkles", items: items }], null));
  }

  function showTyping() {
    if (!els.log) return null;
    var wrap = document.createElement("div");
    wrap.className = "ai-msg ai-bot";
    wrap.id = "aiTyping";
    wrap.innerHTML = '<div class="ai-msg-avatar"><i class="fa-solid fa-robot"></i></div>' +
      '<div class="ai-bubble"><span class="ai-typing"><span></span><span></span><span></span></span></div>';
    els.log.appendChild(wrap);
    els.log.scrollTop = els.log.scrollHeight;
    return wrap;
  }
  function hideTyping() { var t = $("aiTyping"); if (t) t.remove(); }

  function submit(text) {
    text = (text || "").trim();
    if (!text) return;
    var now = Date.now();
    if (now - state.lastSend < getConfig().minSendIntervalMs) return;
    state.lastSend = now;
    if (text.length > 400) text = text.slice(0, 400);

    var lang = AI.detectLang(text, state.uiLang);
    state.lastDetected = lang;
    appendMsg("user", "<div>" + esc(text) + "</div>", null);
    if (els.input) els.input.value = "";
    if (els.suggest) els.suggest.style.display = "none";

    var ctx = state.ctx && state.ctx.available ? state.ctx : AI.buildContext(window.SkyCastData);
    if (!ctx.available) {
      appendMsg("bot", bubbleHTML([{ title: AI.t(lang, "sec_summary"), icon: "fa-database",
        items: [lang === "hi" ? "पहले ऊपर किसी शहर को खोजें या “My Location” दबाएँ।" : "Please search a city above or tap “My Location” first."] }], null), null);
      return;
    }

    showTyping();
    askBackend(text, ctx, lang).then(function (ans) {
      hideTyping();
      if (ans) {
        appendMsg("bot", "<div>" + esc(ans).replace(/\n/g, "<br>") + "</div>", backendEnabled() ? "AI model + live weather data" : null);
      } else {
        var res = AI.answer(text, ctx, lang);
        appendMsg("bot", bubbleHTML(res.sections, null), "Based on live weather data · " + ctx.city);
      }
      if (els.suggest) els.suggest.style.display = "";
      renderSuggestions();
    }).catch(function () {
      hideTyping();
      var res = AI.answer(text, ctx, lang);
      appendMsg("bot", bubbleHTML(res.sections, null), "Based on live weather data · " + ctx.city);
    });
  }

  /* --------------------------- optional AI backend ------------------------ */
  function backendEnabled() { return !!getConfig().backendUrl && state.backendWorking !== false; }

  function buildLLMContext(ctx) {
    var hours = (ctx.timeline || []).slice(0, 12).map(function (s) {
      return { t: s.iso || s.date + "T" + (s.hour < 10 ? "0" : "") + s.hour + ":00", temp: s.temp, feels: s.feels, pop: s.pop, wind: s.windKmh, uv: s.uv, kind: s.kind };
    });
    return {
      city: ctx.city, country: ctx.country, updated: new Date(ctx.updatedAt).toISOString(),
      now: { temp: ctx.now.temp, feels: ctx.now.feels, humidity: ctx.now.humidity, windKmh: ctx.now.windKmh, condition: ctx.now.main, visibilityKm: ctx.now.visibilityKm, sunrise: ctx.now.sunrise, sunset: ctx.now.sunset },
      aqi: ctx.aqi ? { value: ctx.aqi.value, pm25: ctx.aqi.pm25, pm10: ctx.aqi.pm10, scale: ctx.aqi.scale } : null,
      uv: ctx.uv,
      hours: hours,
      comfort: (function () { var a = AI.assess(ctx, "en"); return a.available ? { score: a.score, band: a.band.key } : null; })(),
      warnings: AI.warnings(ctx, "en").map(function (w) { return { level: w.level, title: w.title }; }),
      sources: ctx.sources,
    };
  }

  function askBackend(question, ctx, lang) {
    var cfg = getConfig();
    if (!cfg.backendUrl || state.backendWorking === false) return Promise.resolve(null);
    var key = ctx.city + "|" + lang + "|" + question.toLowerCase();
    if (state.cache.has(key)) return Promise.resolve(state.cache.get(key));

    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, cfg.backendTimeoutMs);

    return fetch(cfg.backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: question,
        language: lang,
        city: ctx.city,
        context: buildLLMContext(ctx),
      }),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      clearTimeout(to);
      var ans = data && (data.answer || data.text);
      if (typeof ans !== "string" || !ans.trim()) throw new Error("empty answer");
      if (state.cache.size > cfg.cacheLimit) state.cache.clear();
      state.cache.set(key, ans);
      state.backendWorking = true;
      return ans;
    }).catch(function () {
      clearTimeout(to);
      state.backendWorking = false;
      renderChatHint();
      if (els.sourceNote && state.ctx) renderSources(state.ctx);
      return null; // graceful fallback to local engine
    });
  }

  /* ------------------------------- voice ---------------------------------- */
  function setupVoice() {
    if (!els.mic) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      els.mic.disabled = true;
      els.mic.title = "Voice input is not supported in this browser";
      els.mic.setAttribute("aria-label", "Voice input not supported");
      return;
    }
    var rec = new SR();
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    var listening = false;

    function stop() { listening = false; els.mic.classList.remove("ai-recording"); }

    rec.onresult = function (e) {
      var text = e.results[0][0].transcript;
      if (els.input) els.input.value = text;
      submit(text);
    };
    rec.onerror = function () { stop(); };
    rec.onend = stop;

    els.mic.addEventListener("click", function () {
      if (listening) { try { rec.stop(); } catch (e) {} stop(); return; }
      rec.lang = effectiveLang() === "hi" ? "hi-IN" : "en-IN";
      try { rec.start(); listening = true; els.mic.classList.add("ai-recording"); }
      catch (e) { stop(); }
    });
  }
})();
