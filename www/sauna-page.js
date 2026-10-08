// Sauna controller — custom web page for ESPHome web_server (v3, js_include, js_url: "").
// Self-contained: no CDN, no external fonts. Talks to the device's own /events (SSE) and REST API.
// Add ?stock to the address to load ESPHome's stock UI instead (needs internet on the phone).

(function () {
  "use strict";

  // ---- entity ids (ESPHome 2026.x: "<domain>/<Entity Name>") ----
  var ID = {
    temp: "sensor/Sauna Temperature",
    remain: "sensor/Run Time Remaining",
    setpt: "number/Sauna Set Temperature",
    band: "number/Sauna Deadband",
    offset: "number/Sauna Calibration Offset",
    lightoff: "number/Sauna Lights Offset",
    lights: "light/Sauna Lights",
    therm: "switch/Internal Thermometer Supply",
    heating: "binary_sensor/Sauna Heater",
    status: "text_sensor/Heater Enabled",
    reset: "button/Reset Run Timer",
    end: "button/End Run Timer"
  };
  // Older ESPHome sends ids like "sensor-sauna_temperature"; newer sends "sensor/Sauna Temperature".
  var KEYS = {}, ALIAS = {}, seen = {}, DEFMETA = {};
  Object.keys(ID).forEach(function (k) {
    var full = ID[k], dom = full.split("/")[0], name = full.slice(dom.length + 1);
    if (dom !== "button") KEYS[full] = true;
    ALIAS[full] = full;
    ALIAS[dom + "-" + name.toLowerCase().replace(/ /g, "_").replace(/[^a-z0-9_]/g, "")] = full;
  });
  DEFMETA[ID.setpt] = { min: 0, max: 100, step: 1 };
  DEFMETA[ID.band] = { min: 0, max: 10, step: 0.1 };
  DEFMETA[ID.offset] = { min: -40, max: 40, step: 0.1 };
  DEFMETA[ID.lightoff] = { min: -40, max: 40, step: 0.1 };
  var matched = {}, nEvents = 0, lastUnknown = "";
  var WINDOW_MS = 60 * 60 * 1000;
  var SAMPLE_MS = 5000;
  var LS_KEY = "sauna-history-v1";

  if (/[?&]stock\b/.test(location.search)) {
    var s = document.createElement("script");
    s.src = "https://oi.esphome.io/v3/www.js";
    document.head.appendChild(s);
    return;
  }

  var st = {};          // id -> latest parsed state
  var meta = {};        // id -> {min,max,step}
  var history = [];     // {t, v, h, s}
  var remainBase = null; // {v, at}
  var lastEvent = 0;

  // ---------- helpers ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { el.appendChild(c); });
    return el;
  }
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : null; }
  function urls(id, action, q) {
    var dom = id.split("/")[0], name = id.slice(dom.length + 1), raw = seen[id];
    var segs = [];
    if (raw) segs.push(raw.indexOf("/") >= 0 ? raw.slice(raw.indexOf("/") + 1) : raw.slice(raw.indexOf("-") + 1));
    segs.push(name);                                                        // newer ESPHome: entity name
    segs.push(name.toLowerCase().replace(/ /g, "_").replace(/[^a-z0-9_]/g, "")); // older: object id
    return segs.filter(function (x, i) { return segs.indexOf(x) === i; }).map(function (sg) {
      return "/" + dom + "/" + encodeURIComponent(sg) + "/" + action + (q || "");
    });
  }
  function post(id, action, q) {
    var list = urls(id, action, q);
    function go(i) {
      return fetch(list[i], { method: "POST", credentials: "same-origin" }).then(function (r) {
        if (r.ok) return r;
        if (i + 1 < list.length) return go(i + 1);
        throw new Error(r.status);
      });
    }
    return go(0);
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ---------- styles ----------
  var CSS = [
    ":root{--bg:#1c2429;--panel:#27333a;--line:#3a4850;--ink:#e6eef0;--dim:#93a4ab;--steam:#7cc4d4;--ember:#ff8a3d;--bad:#ff6b5e;--on-accent:#10181b;color-scheme:dark}",
    "@media (prefers-color-scheme:light){:root{--bg:#eef1ee;--panel:#dfe6e4;--line:#c2cdca;--ink:#1c2529;--dim:#55666d;--steam:#1f7f93;--ember:#d9560b;--bad:#c4382b;--on-accent:#fff;color-scheme:light}}",
    "html,body{margin:0;background:var(--bg)}",
    "#sp{box-sizing:border-box;max-width:520px;margin:0 auto;padding:14px 16px 40px;color:var(--ink);font:16px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums}",
    "#sp *{box-sizing:border-box}",
    "#sp header{display:flex;align-items:center;gap:10px;padding:6px 0 10px}",
    "#sp h1{font-size:20px;font-weight:600;margin:0;flex:1}",
    "#sp .pill{padding:4px 12px;border-radius:99px;font-size:14px;font-weight:600;background:var(--panel);color:var(--dim);border:1px solid var(--line)}",
    "#sp .pill.ready{background:var(--steam);color:var(--on-accent);border-color:var(--steam)}",
    "#sp .pill.times{background:var(--ember);color:var(--on-accent);border-color:var(--ember)}",
    "#sp .dot{width:10px;height:10px;border-radius:50%;background:var(--bad)}",
    "#sp .dot.ok{background:var(--steam)}",
    "#sp .hero{display:flex;align-items:baseline;gap:12px;margin-top:4px}",
    "#sp .big{font-size:72px;font-weight:300;line-height:1;letter-spacing:-1px}",
    "#sp .big small{font-size:28px;font-weight:300;color:var(--dim);margin-left:2px}",
    "#sp .heat{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:15px;color:var(--dim);align-self:center}",
    "#sp .led{width:16px;height:16px;border-radius:50%;border:2px solid var(--dim)}",
    "#sp .heat.on{color:var(--ember)}",
    "#sp .heat.on .led{background:var(--ember);border-color:var(--ember);box-shadow:0 0 12px var(--ember)}",
    "#sp .track{position:relative;height:14px;border-radius:7px;background:var(--panel);margin:14px 0 6px;overflow:visible}",
    "#sp .fill{position:absolute;left:0;top:0;bottom:0;border-radius:7px;background:var(--steam);width:0;transition:width .6s,background .6s}",
    "#sp .track.hot .fill{background:var(--ember)}",
    "#sp .tick{position:absolute;top:-5px;bottom:-5px;width:3px;margin-left:-1px;border-radius:2px;background:var(--ink)}",
    "#sp .tracklab{display:flex;justify-content:space-between;font-size:13px;color:var(--dim)}",
    "#sp section{border-top:1px solid var(--line);margin-top:18px;padding-top:14px}",
    "#sp canvas{width:100%;height:190px;display:block;touch-action:pan-y}",
    "#sp .row{display:flex;align-items:center;justify-content:space-between;gap:12px}",
    "#sp .lab{color:var(--dim);font-size:15px}",
    "#sp .time{font-size:44px;font-weight:300;line-height:1.1}",
    "#sp .btns{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}",
    "#sp button{font:inherit;font-weight:600;min-height:52px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;padding:0 12px}",
    "#sp button:active{transform:scale(.97)}",
    "#sp button.danger{border-color:var(--bad);color:var(--bad);background:transparent}",
    "#sp button.sq{width:56px;min-height:56px;font-size:28px;padding:0;flex:none}",
    "#sp input[type=text],#sp input[type=number]{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center;width:96px;min-height:48px}",
    "#sp input.setin{font-size:32px;font-weight:300;width:110px;min-height:56px}",
    "#sp input.flash-ok{border-color:var(--steam)}",
    "#sp input.flash-bad{border-color:var(--bad)}",
    "#sp input[type=range]{flex:1;min-width:0;height:44px;accent-color:var(--steam)}",
    "#sp .bulb{width:48px;height:48px;border-radius:50%;border:3px solid var(--ink);background:transparent;padding:0;flex:none}",
    "#sp .bulb.on{background:#ffe14a;border-color:#ffe14a;box-shadow:0 0 14px #ffe14a88}",
    "#sp .pct{width:44px;text-align:right;color:var(--dim);font-size:15px}",
    "#sp details summary{cursor:pointer;color:var(--dim);padding:6px 0;min-height:32px}",
    "#sp details .row{margin-top:12px}",
    "#sp .tog{min-width:72px}",
    "#sp .tog.on{background:var(--steam);color:var(--on-accent);border-color:var(--steam)}",
    "#sp footer{margin-top:22px;color:var(--dim);font-size:13px;display:flex;justify-content:space-between;gap:10px}",
    "#sp footer a{color:var(--dim)}",
    "#sp :focus-visible{outline:3px solid var(--steam);outline-offset:2px}",
    "@media (prefers-reduced-motion:reduce){#sp *{transition:none!important}}"
  ].join("\n");

  // ---------- UI ----------
  var ui = {};
  function build() {
    var root = h("div", { id: "sp" });
    var style = h("style", { text: CSS });

    ui.dot = h("span", { class: "dot", title: "Connection" });
    ui.pill = h("span", { class: "pill", text: "--" });
    root.appendChild(h("header", {}, [h("h1", { text: "Sauna" }), ui.pill, ui.dot]));

    ui.temp = h("span", { class: "big" });
    ui.heat = h("div", { class: "heat" }, [h("span", { class: "led" }), (ui.heatTxt = h("span", { text: "Idle" }))]);
    root.appendChild(h("div", { class: "hero" }, [ui.temp, ui.heat]));

    ui.fill = h("div", { class: "fill" });
    ui.tick = h("div", { class: "tick" });
    ui.track = h("div", { class: "track" }, [ui.fill, ui.tick]);
    ui.trackLab = h("span", { text: "Set --" });
    root.appendChild(ui.track);
    root.appendChild(h("div", { class: "tracklab" }, [h("span", { text: "0" }), ui.trackLab, h("span", { text: "100" })]));

    // chart
    ui.canvas = h("canvas");
    ui.readout = h("div", { class: "lab", text: "Last 60 minutes" });
    root.appendChild(h("section", {}, [ui.canvas, ui.readout]));

    // timer
    ui.time = h("div", { class: "time", text: "--:--" });
    var bReset = h("button", { type: "button", text: "Reset" });
    var bEnd = h("button", { type: "button", class: "danger", text: "End" });
    bReset.onclick = function () { act(bReset, ID.reset, "press"); };
    bEnd.onclick = function () { act(bEnd, ID.end, "press"); };
    root.appendChild(h("section", {}, [
      h("div", { class: "row" }, [h("span", { class: "lab", text: "Time left" }), ui.time]),
      h("div", { class: "btns" }, [bReset, bEnd])
    ]));

    // setpoint
    ui.setin = h("input", { type: "text", inputmode: "decimal", class: "setin", "aria-label": "Set temperature" });
    var bMinus = h("button", { type: "button", class: "sq", text: "−", "aria-label": "Lower setpoint" });
    var bPlus = h("button", { type: "button", class: "sq", text: "+", "aria-label": "Raise setpoint" });
    bMinus.onclick = function () { stepSet(-1); };
    bPlus.onclick = function () { stepSet(1); };
    ui.setin.onchange = function () { commitNumber(ID.setpt, ui.setin); };
    root.appendChild(h("section", {}, [
      h("div", { class: "row" }, [h("span", { class: "lab", text: "Setpoint °C" }), h("div", { class: "row" }, [bMinus, ui.setin, bPlus])])
    ]));

    // lights
    ui.bulb = h("button", { type: "button", class: "bulb", "aria-label": "Lights" });
    ui.slider = h("input", { type: "range", min: "0", max: "100", step: "1", "aria-label": "Light brightness" });
    ui.pct = h("span", { class: "pct", text: "" });
    ui.bulb.onclick = function () { post(ID.lights, "toggle").catch(fail); };
    var sliding = false, sendTimer = null;
    ui.slider.addEventListener("input", function () {
      sliding = true;
      ui.pct.textContent = ui.slider.value + "%";
      if (sendTimer) return;
      sendTimer = setTimeout(function () {
        sendTimer = null;
        sendBrightness(+ui.slider.value);
      }, 150);
    });
    ui.slider.addEventListener("change", function () {
      sendBrightness(+ui.slider.value);
      setTimeout(function () { sliding = false; }, 600);
    });
    ui.isSliding = function () { return sliding; };
    root.appendChild(h("section", {}, [
      h("div", { class: "row" }, [h("span", { class: "lab", text: "Lights" }), ui.bulb, ui.slider, ui.pct])
    ]));

    // settings
    ui.band = h("input", { type: "text", inputmode: "decimal", "aria-label": "Deadband" });
    ui.offset = h("input", { type: "text", inputmode: "decimal", "aria-label": "Calibration offset" });
    ui.band.onchange = function () { commitNumber(ID.band, ui.band); };
    ui.offset.onchange = function () { commitNumber(ID.offset, ui.offset); };
    ui.lightoff = h("input", { type: "text", inputmode: "decimal", "aria-label": "Lights-on offset" });
    ui.lightoff.onchange = function () { commitNumber(ID.lightoff, ui.lightoff); };
    ui.precise = h("span", { text: "--" });
    ui.therm = h("button", { type: "button", class: "tog", text: "Off" });
    ui.therm.onclick = function () { post(ID.therm, "toggle").catch(fail); };
    root.appendChild(h("section", {}, [
      h("details", {}, [
        h("summary", { text: "Settings" }),
        h("div", { class: "row" }, [h("span", { class: "lab", text: "Deadband °C" }), ui.band]),
        h("div", { class: "row" }, [h("span", { class: "lab", text: "Calibration offset °C" }), ui.offset]),
        h("div", { class: "row" }, [h("span", { class: "lab", text: "Offset with lights on °C" }), ui.lightoff]),
        h("div", { class: "row" }, [h("span", { class: "lab", text: "Reading, 2 decimals" }), ui.precise]),
        h("div", { class: "row" }, [h("span", { class: "lab", text: "Thermometer supply" }), ui.therm])
      ])
    ]));

    ui.updated = h("span", { text: "Connecting…" });
    root.appendChild(h("footer", {}, [ui.updated, h("a", { href: "?stock", text: "Stock view" })]));

    document.head.appendChild(style);
    document.body.appendChild(root);
    ui.root = root;

    bindChart();
  }

  var failTimer;
  function fail(e) {
    ui.updated.textContent = "Command failed" + (e && e.message ? " (" + e.message + ")" : "");
    clearTimeout(failTimer);
    failTimer = setTimeout(function () { ui.updated.textContent = ""; }, 4000);
  }
  function act(btn, id, action) {
    btn.disabled = true;
    post(id, action).catch(fail).then(function () { setTimeout(function () { btn.disabled = false; }, 400); });
  }

  // ---------- controls ----------
  var setTimer;
  function stepSet(dir) {
    var m = meta[ID.setpt] || DEFMETA[ID.setpt];
    var cur = num(ui.setin.value);
    if (cur === null) cur = num(st[ID.setpt]);
    if (cur === null) return;
    var v = Math.min(m.max, Math.max(m.min, cur + dir * m.step));
    ui.setin.value = fmtNum(v, m.step);
    clearTimeout(setTimer);
    setTimer = setTimeout(function () { commitNumber(ID.setpt, ui.setin); }, 450);
  }
  function fmtNum(v, step) {
    var d = step && step < 1 ? 1 : 0;
    return v.toFixed(d);
  }
  function flash(el, cls) {
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 900);
  }
  function commitNumber(id, input) {
    var m = meta[id] || DEFMETA[id] || {};
    var v = num(String(input.value).replace(",", "."));
    if (v === null || (m.min != null && v < m.min) || (m.max != null && v > m.max)) {
      flash(input, "flash-bad");
      input.value = fmtNum(num(st[id]) || 0, m.step);
      return;
    }
    post(id, "set", "?value=" + encodeURIComponent(v)).then(function () { flash(input, "flash-ok"); }).catch(function (e) { flash(input, "flash-bad"); fail(e); });
  }
  function sendBrightness(pct) {
    if (pct <= 0) post(ID.lights, "turn_off").catch(fail);
    else post(ID.lights, "turn_on", "?brightness=" + Math.round(pct * 2.55)).catch(fail);
  }

  // ---------- state handling ----------
  function parse(d) {
    var raw = d.id;
    if (!raw) return;
    nEvents++;
    var id = ALIAS[raw];
    if (!id && d.name) id = ALIAS[String(raw).split(/[-\/]/)[0] + "/" + d.name];
    if (!id) { lastUnknown = raw; return; }
    seen[id] = raw;
    matched[id] = true;
    var dom = id.split("/")[0];
    if (dom === "light") {
      st[id] = { on: d.state === "ON" || d.value === "ON", br: num(d.brightness) };
    } else if (dom === "sensor") {
      st[id] = (d.value === null || d.value === undefined || d.state === "NA") ? null : num(d.value);
    } else if (dom === "number") {
      st[id] = num(d.value);
      if (d.min_value !== undefined) meta[id] = { min: num(d.min_value), max: num(d.max_value), step: num(d.step) || 1 };
    } else if (dom === "binary_sensor" || dom === "switch") {
      st[id] = d.value === true || d.state === "ON";
    } else {
      st[id] = d.value !== undefined ? d.value : d.state;
    }
    onChange(id);
  }

  function onChange(id) {
    lastEvent = Date.now();
    if (id === ID.temp) {
      var t = st[ID.temp];
      if (t !== null) sample(t);
    }
    if (id === ID.remain) remainBase = { v: st[ID.remain], at: Date.now() };
    render();
  }

  function sample(v) {
    var now = Date.now();
    var last = history[history.length - 1];
    if (last && now - last.t < SAMPLE_MS) return;
    history.push({ t: now, v: v, h: st[ID.heating] ? 1 : 0, s: num(st[ID.setpt]) });
    var cut = now - WINDOW_MS;
    while (history.length && history[0].t < cut) history.shift();
  }

  function render() {
    var t = st[ID.temp];
    ui.temp.textContent = "";
    ui.temp.appendChild(document.createTextNode(t === null || t === undefined ? "--" : (Math.round(t * 2) / 2).toFixed(1)));   // shown to nearest 0.5
    ui.temp.appendChild(h("small", { text: "°C" }));
    if (t !== null && t !== undefined) document.title = t.toFixed(0) + "°C Sauna";

    var heating = !!st[ID.heating];
    ui.heat.classList.toggle("on", heating);
    ui.heatTxt.textContent = heating ? "Heating" : "Idle";
    ui.track.classList.toggle("hot", heating);

    var sp = num(st[ID.setpt]);
    var pct = function (x) { return Math.max(0, Math.min(100, x)); };
    ui.fill.style.width = (t === null || t === undefined ? 0 : pct(t)) + "%";
    if (sp !== null) {
      ui.tick.style.left = pct(sp) + "%";
      ui.trackLab.textContent = "Set " + sp.toFixed(0) + "°C";
      if (document.activeElement !== ui.setin && !setTimer) ui.setin.value = fmtNum(sp, (meta[ID.setpt] || {}).step);
    }

    var status = st[ID.status];
    ui.pill.textContent = status || "--";
    ui.pill.className = "pill" + (status === "Ready" ? " ready" : status === "Times Up" ? " times" : "");

    var L = st[ID.lights];
    if (L) {
      var dim = L.br != null;
      ui.slider.style.display = dim ? "" : "none";
      if (!dim) { ui.bulb.classList.toggle("on", L.on); ui.pct.textContent = L.on ? "on" : "off"; ui.pct.style.flex = "1"; ui.pct.style.textAlign = "left"; }
      ui.bulb.classList.toggle("on", L.on);
      if (dim && !ui.isSliding()) {
        var p = L.on ? Math.round(((L.br == null ? 255 : L.br) / 255) * 100) : 0;
        if (L.on || document.activeElement !== ui.slider) ui.slider.value = p;
        ui.pct.textContent = L.on ? p + "%" : "off";
      }
    }

    if (document.activeElement !== ui.band && st[ID.band] != null) ui.band.value = fmtNum(st[ID.band], 0.1);
    if (document.activeElement !== ui.offset && st[ID.offset] != null) ui.offset.value = fmtNum(st[ID.offset], 0.1);
    if (document.activeElement !== ui.lightoff && st[ID.lightoff] != null) ui.lightoff.value = fmtNum(st[ID.lightoff], 0.1);
    ui.precise.textContent = (t === null || t === undefined) ? "--" : t.toFixed(2) + " °C";
    var th = !!st[ID.therm];
    ui.therm.classList.toggle("on", th);
    ui.therm.textContent = th ? "On" : "Off";

    drawChart();
  }

  // 1 Hz tick: smooth countdown, connection state, chart slide
  function tick() {
    var r = st[ID.remain];
    if (r === null || r === undefined || !remainBase) {
      ui.time.textContent = "--:--";
    } else {
      var left = r > 0 ? r - (Date.now() - remainBase.at) / 1000 : 0;
      ui.time.textContent = fmtTime(left);
    }
    var age = Date.now() - lastEvent;
    var ok = lastEvent && age < 30000;
    ui.dot.classList.toggle("ok", !!ok);
    var nm = Object.keys(matched).length, nt = Object.keys(KEYS).length;
    if (nEvents && nm < nt && !failTimer) {
      ui.updated.textContent = nm + " of " + nt + " items found" + (lastUnknown ? " (unknown: " + lastUnknown + ")" : "");
    } else if (!nEvents && !failTimer) {
      ui.updated.textContent = "Waiting for device\u2026";
    } else if (lastEvent && !failTimer) ui.updated.textContent = ok ? "Updated " + (age < 3000 ? "just now" : Math.round(age / 1000) + "s ago") : "No data for " + Math.round(age / 1000) + "s";
    drawChart();
  }

  // ---------- chart ----------
  var cx, hover = null;
  function bindChart() {
    var c = ui.canvas;
    function move(e) {
      var r = c.getBoundingClientRect();
      hover = e.clientX - r.left;
      drawChart();
    }
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerdown", move);
    c.addEventListener("pointerleave", function () { hover = null; drawChart(); });
    window.addEventListener("resize", drawChart);
  }
  function css(n) { return getComputedStyle(ui.root).getPropertyValue(n).trim(); }

  function drawChart() {
    var c = ui.canvas;
    if (!c || !c.clientWidth) return;
    var dpr = window.devicePixelRatio || 1;
    var W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    var g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    var dim = css("--dim"), line = css("--line"), steam = css("--steam"), ember = css("--ember"), ink = css("--ink");
    var pad = { l: 38, r: 6, t: 8, b: 20 };
    var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    g.font = "12px system-ui,sans-serif";

    if (history.length < 2) {
      g.fillStyle = dim; g.textAlign = "left";
      g.fillText("Collecting data…", pad.l, H / 2);
      return;
    }
    var now = Date.now(), t0 = now - WINDOW_MS;
    var vmin = Infinity, vmax = -Infinity;
    history.forEach(function (p) { vmin = Math.min(vmin, p.v); vmax = Math.max(vmax, p.v); if (p.s != null) { vmin = Math.min(vmin, p.s); vmax = Math.max(vmax, p.s); } });
    if (vmax - vmin < 10) { var mid = (vmax + vmin) / 2; vmin = mid - 5; vmax = mid + 5; }
    var span = vmax - vmin; vmin -= span * 0.08; vmax += span * 0.08;
    var X = function (t) { return pad.l + (t - t0) / WINDOW_MS * pw; };
    var Y = function (v) { return pad.t + ph - (v - vmin) / (vmax - vmin) * ph; };

    // grid + y labels
    g.strokeStyle = line; g.lineWidth = 1; g.fillStyle = dim; g.textAlign = "right";
    for (var i = 0; i <= 4; i++) {
      var v = vmin + (vmax - vmin) * i / 4, y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke();
      g.fillText(v.toFixed(0), pad.l - 6, y + 4);
    }
    g.textAlign = "center";
    [0, 15, 30, 45, 60].forEach(function (m) {
      var x = X(now - m * 60000);
      g.fillText(m === 0 ? "now" : "-" + m + "m", Math.min(Math.max(x, pad.l + 12), W - 14), H - 5);
    });

    // heater-on bands
    g.fillStyle = ember; g.globalAlpha = 0.16;
    for (var j = 0; j < history.length; j++) {
      if (!history[j].h) continue;
      var a = j, b = j;
      while (b + 1 < history.length && history[b + 1].h && history[b + 1].t - history[b].t < 60000) b++;
      var xa = X(history[a].t), xb = X(history[Math.min(b + 1, history.length - 1)].t);
      g.fillRect(xa, pad.t, Math.max(2, xb - xa), ph);
      j = b;
    }
    g.globalAlpha = 1;

    // setpoint (dashed, uses each sample's setpoint)
    g.strokeStyle = ink; g.globalAlpha = 0.55; g.lineWidth = 1; g.setLineDash([5, 4]);
    g.beginPath();
    var started = false;
    history.forEach(function (p) {
      if (p.s == null) return;
      var x = X(p.t), y = Y(p.s);
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    });
    g.stroke(); g.setLineDash([]); g.globalAlpha = 1;

    // temperature line (break across gaps)
    g.strokeStyle = steam; g.lineWidth = 2.5; g.lineJoin = "round";
    g.beginPath();
    history.forEach(function (p, k) {
      var x = X(p.t), y = Y(p.v);
      if (k === 0 || p.t - history[k - 1].t > 60000) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.stroke();

    // hover readout
    if (hover !== null) {
      var tt = t0 + (hover - pad.l) / pw * WINDOW_MS, best = null, bd = Infinity;
      history.forEach(function (p) { var d = Math.abs(p.t - tt); if (d < bd) { bd = d; best = p; } });
      if (best && bd < 120000) {
        var hx = X(best.t);
        g.strokeStyle = ink; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(hx, pad.t); g.lineTo(hx, pad.t + ph); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = steam; g.beginPath(); g.arc(hx, Y(best.v), 4, 0, 7); g.fill();
        var mins = Math.round((now - best.t) / 60000);
        ui.readout.textContent = best.v.toFixed(1) + "°C, " + (mins === 0 ? "now" : mins + " min ago") + (best.h ? ", heating" : "");
      }
    } else {
      ui.readout.textContent = "Last 60 minutes";
    }
  }

  // ---------- persistence of chart history ----------
  function loadHistory() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var a = JSON.parse(raw), cut = Date.now() - WINDOW_MS;
      if (Array.isArray(a)) history = a.filter(function (p) { return p && p.t > cut && isFinite(p.v); });
    } catch (e) { /* storage unavailable */ }
  }
  function saveHistory() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(history)); } catch (e) { /* ignore */ }
  }

  // ---------- connection ----------
  function connect() {
    var es = new EventSource("/events");
    es.addEventListener("state", function (e) {
      try { parse(JSON.parse(e.data)); } catch (err) { /* ignore malformed */ }
    });
    es.addEventListener("ping", function () { lastEvent = Date.now(); });
    es.onerror = function () { /* EventSource reconnects by itself */ };
  }

  function init() {
    build();
    loadHistory();
    render();
    connect();
    setInterval(tick, 1000);
    setInterval(saveHistory, 30000);
    document.addEventListener("visibilitychange", function () { if (document.hidden) saveHistory(); else tick(); });
    var app = document.querySelector("esp-app");
    if (app) app.style.display = "none";
  }

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  } catch (e) {
    if (window.console) console.error("sauna page failed, showing stock UI", e);
  }
})();
