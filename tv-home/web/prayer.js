// Prayer times on the home (local fork). Computed on the TV, no network: Umm al-Qura method
// (Fajr at 18.5 degrees, Isha 90 minutes after Maghrib, 120 in Ramadan), Asr by the standard
// (Shafi'i) shadow. Place and time zone come from config.json "weather" (lat, lon, timezone).
// window.PrayerTimes.times(date, lat, lon, tz) returns the six times as Date objects.
(function () {
  "use strict";

  var RAD = Math.PI / 180;
  var FAJR_ANGLE = 18.5;
  var SUN_ANGLE = 0.833;          // refraction and the sun's radius at sunrise and sunset
  var ISHA_MINUTES = 90;
  var ISHA_MINUTES_RAMADAN = 120;
  var RAMADAN = 9;

  var NAMES = {
    ar: { fajr: "الفجر", sunrise: "الشروق", dhuhr: "الظهر", asr: "العصر", maghrib: "المغرب", isha: "العشاء",
          in: "بعد", h: "س", m: "د", now: "حان الآن" },
    en: { fajr: "Fajr", sunrise: "Sunrise", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha",
          in: "in", h: "h", m: "m", now: "now" }
  };
  var ORDER = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

  function sin(d) { return Math.sin(d * RAD); }
  function cos(d) { return Math.cos(d * RAD); }
  function tan(d) { return Math.tan(d * RAD); }
  function asinD(x) { return Math.asin(x) / RAD; }
  function acosD(x) { return Math.acos(x) / RAD; }
  function atan2D(y, x) { return Math.atan2(y, x) / RAD; }
  function fix(a, b) { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; }

  // The sun's declination and the equation of time (hours) at a Julian date.
  function sun(jd) {
    var d = jd - 2451545.0;
    var g = fix(357.529 + 0.98560028 * d, 360);
    var q = fix(280.459 + 0.98564736 * d, 360);
    var l = fix(q + 1.915 * sin(g) + 0.020 * sin(2 * g), 360);
    var e = 23.439 - 0.00000036 * d;
    var ra = fix(atan2D(cos(e) * sin(l), cos(l)) / 15, 24);
    var eqt = q / 15 - ra;
    if (eqt > 12) eqt -= 24;
    if (eqt < -12) eqt += 24;
    return { decl: asinD(sin(e) * sin(l)), eqt: eqt };
  }

  // Hours from UTC midnight when the sun is `angle` degrees below the horizon, before (-1) or
  // after (+1) noon; angle null is noon itself. Refined with the sun's position at each estimate.
  function solve(jd0, lat, lon, angle, dir, guess) {
    var t = guess;
    for (var i = 0; i < 2; i++) {
      var s = sun(jd0 + t / 24);
      var noon = 12 - s.eqt - lon / 15;
      if (angle === null) { t = noon; continue; }
      var c = (-sin(angle) - sin(s.decl) * sin(lat)) / (cos(s.decl) * cos(lat));
      if (c < -1 || c > 1) return NaN;
      t = noon + dir * acosD(c) / 15;
    }
    return t;
  }

  // Asr: the sun's altitude where an object's shadow is its length plus its noon shadow.
  function asrAngle(jd0, lat, t) {
    var decl = sun(jd0 + t / 24).decl;
    return -Math.atan(1 / (1 + tan(Math.abs(lat - decl)))) / RAD;
  }

  // The calendar date (year, month, day) it is in time zone tz at `date`.
  function localYmd(date, tz) {
    var parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date);
    var o = {};
    parts.forEach(function (p) { o[p.type] = +p.value; });
    return o;
  }

  function isRamadan(date, tz) {
    try {
      var m = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { timeZone: tz, month: "numeric" }).format(date);
      return parseInt(m, 10) === RAMADAN;
    } catch (e) {
      return false;
    }
  }

  function times(date, lat, lon, tz) {
    var ymd = localYmd(date, tz);
    var utc0 = Date.UTC(ymd.year, ymd.month - 1, ymd.day);
    var jd0 = utc0 / 86400000 + 2440587.5;
    var noonGuess = 12 - lon / 15;
    var dhuhr = solve(jd0, lat, lon, null, 0, noonGuess);
    var hours = {
      fajr: solve(jd0, lat, lon, FAJR_ANGLE, -1, noonGuess - 6),
      sunrise: solve(jd0, lat, lon, SUN_ANGLE, -1, noonGuess - 6),
      dhuhr: dhuhr,
      asr: solve(jd0, lat, lon, asrAngle(jd0, lat, dhuhr + 3), 1, dhuhr + 3),
      maghrib: solve(jd0, lat, lon, SUN_ANGLE, 1, noonGuess + 6)
    };
    hours.isha = hours.maghrib + (isRamadan(date, tz) ? ISHA_MINUTES_RAMADAN : ISHA_MINUTES) / 60;
    var out = {};
    ORDER.forEach(function (k) {
      var ms = Math.round(hours[k] * 60) * 60000;
      out[k] = isNaN(ms) ? null : new Date(utc0 + ms);
    });
    return out;
  }

  // ------------------------------------------------------------------ the strip on the home

  var TICK_MS = 20000;
  var DAY_MS = 86400000;
  var DEFAULT_PLACE = { lat: 24.7136, lon: 46.6753, timezone: "Asia/Riyadh" };

  function place() {
    var w = (window.COUCH_CONFIG && window.COUCH_CONFIG.weather) || {};
    var ok = typeof w.lat === "number" && typeof w.lon === "number";
    return ok ? { lat: w.lat, lon: w.lon, timezone: w.timezone || DEFAULT_PLACE.timezone } : DEFAULT_PLACE;
  }

  function words() {
    var lang = window.I18N && window.I18N.lang ? window.I18N.lang() : "en";
    return NAMES[lang] || NAMES.en;
  }

  function hm(date, tz) {
    var s = date.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
    return s.replace(/\s?[AP]M$/i, "");
  }

  function untilText(ms, w) {
    var mins = Math.max(0, Math.ceil(ms / 60000));
    if (mins === 0) return w.now;
    var h = Math.floor(mins / 60), m = mins % 60;
    return w.in + " " + (h ? h + w.h + " " : "") + m + w.m;
  }

  // The next prayer (sunrise is shown but never "next"): today's, or tomorrow's Fajr after Isha.
  function nextPrayer(now, p) {
    var today = times(now, p.lat, p.lon, p.timezone);
    for (var i = 0; i < ORDER.length; i++) {
      var k = ORDER[i];
      if (k !== "sunrise" && today[k] && today[k] > now) return { key: k, at: today[k], today: today };
    }
    var tomorrow = times(new Date(now.getTime() + DAY_MS), p.lat, p.lon, p.timezone);
    return { key: "fajr", at: tomorrow.fajr, today: tomorrow };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; });
  }

  // The sun's altitude (degrees) at `date`, for the little arc over the strip.
  function altitude(date, lat, lon) {
    var jd = date.getTime() / DAY_MS + 2440587.5;
    var s = sun(jd);
    var utcH = (date.getTime() % DAY_MS) / 3600000;
    var ha = (utcH + lon / 15 + s.eqt - 12) * 15;
    return asinD(sin(lat) * sin(s.decl) + cos(lat) * cos(s.decl) * cos(ha));
  }

  var ARC_H = 22;      // px of arc above the strip (in CSS px at the 1920 wide layout)
  var ARC_PAD = 3.5;

  // A smooth hairline through the prayers' altitudes, placed over each column, with a brass
  // stretch from now to the next prayer: the plate's sun arc, folded into the strip.
  function drawArc(el, n, now, p) {
    var svg = el.querySelector(".arc");
    var cols = el.querySelectorAll(".pr");
    if (!svg || cols.length !== ORDER.length) return;
    var box = el.getBoundingClientRect(), scale = box.width / el.offsetWidth || 1;
    var alts = ORDER.map(function (k) { return altitude(n.today[k], p.lat, p.lon); });
    var hi = Math.max.apply(null, alts), lo = Math.min.apply(null, alts);
    var y = function (a) { return ARC_PAD + (ARC_H - 2 * ARC_PAD) * (1 - (a - lo) / ((hi - lo) || 1)); };
    var pts = ORDER.map(function (k, i) {
      var r = cols[i].getBoundingClientRect();
      return [((r.left + r.right) / 2 - box.left) / scale, y(alts[i])];
    });
    var d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 1; i < pts.length; i++) {
      var mx = (pts[i - 1][0] + pts[i][0]) / 2;
      d += " C" + mx.toFixed(1) + " " + pts[i - 1][1].toFixed(1) + " " + mx.toFixed(1) + " " + pts[i][1].toFixed(1) +
        " " + pts[i][0].toFixed(1) + " " + pts[i][1].toFixed(1);
    }
    var ni = ORDER.indexOf(n.key), horizon = y(-SUN_ANGLE);
    var w = el.offsetWidth;
    // where "now" sits between the previous prayer and the next one
    var pi = ni > 0 ? ni - 1 : -1, nowX = pts[ni][0];
    if (pi >= 0 && n.today[ORDER[pi]] <= now) {
      var f = (now - n.today[ORDER[pi]]) / (n.today[ORDER[ni]] - n.today[ORDER[pi]]);
      nowX = pts[pi][0] + (pts[ni][0] - pts[pi][0]) * Math.max(0, Math.min(1, f));
    }
    var dots = pts.map(function (q, i) {
      return i === ni ? "" : '<circle class="dot' + (ORDER[i] === "sunrise" ? " sun" : "") + '" cx="' + q[0].toFixed(1) +
        '" cy="' + q[1].toFixed(1) + '" r="2.2"/>';
    }).join("");
    svg.setAttribute("viewBox", "0 0 " + w + " " + ARC_H);
    svg.innerHTML =
      '<line class="hz" x1="0" x2="' + w + '" y1="' + horizon.toFixed(1) + '" y2="' + horizon.toFixed(1) + '"/>' +
      '<defs><clipPath id="pr-now"><rect x="' + Math.min(nowX, pts[ni][0]).toFixed(1) + '" y="0" width="' +
      Math.abs(pts[ni][0] - nowX).toFixed(1) + '" height="' + ARC_H + '"/></clipPath></defs>' +
      '<path class="line" d="' + d + '"/><path class="lit" clip-path="url(#pr-now)" d="' + d + '"/>' + dots +
      '<circle class="halo" cx="' + pts[ni][0].toFixed(1) + '" cy="' + pts[ni][1].toFixed(1) + '" r="7"/>' +
      '<circle class="next" cx="' + pts[ni][0].toFixed(1) + '" cy="' + pts[ni][1].toFixed(1) + '" r="3.4"/>';
  }

  var lastHtml = "", lastArc = "";
  function render() {
    var el = document.getElementById("prayer");
    if (!el || document.hidden) return;
    try {
      var p = place(), w = words(), now = new Date();
      var n = nextPrayer(now, p);
      var html = '<svg class="arc" aria-hidden="true" preserveAspectRatio="none" height="' + ARC_H + '"></svg>' +
        ORDER.map(function (k) {
          var at = n.today[k];
          if (!at) return "";
          var isNext = k === n.key;
          var cls = "pr" + (isNext ? " next" : "") + (k === "sunrise" ? " sun" : "");
          var name = esc(w[k]) + (isNext ? '<i class="in"> · ' + esc(untilText(at - now, w)) + "</i>" : "");
          return '<span class="' + cls + '"><span class="pn">' + name + "</span><b>" + esc(hm(at, p.timezone)) + "</b></span>";
        }).join("");
      if (html !== lastHtml) { el.innerHTML = html; lastHtml = html; lastArc = ""; }
      el.classList.add("ready");
      var arcKey = n.key + Math.floor(now / 60000) + el.offsetWidth;
      if (arcKey !== lastArc) { drawArc(el, n, now, p); lastArc = arcKey; }
    } catch (e) {
      el.classList.remove("ready");
      if (window.console) console.warn("prayer times:", e);
    }
  }

  // The arc follows the columns, so draw it again once the fonts have changed their widths.
  function redrawArc() { lastArc = ""; render(); }

  function start() {
    render();
    setInterval(render, TICK_MS);
    document.addEventListener("visibilitychange", render);
    window.addEventListener("resize", redrawArc);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawArc);
  }

  window.PrayerTimes = { times: times, ORDER: ORDER, NAMES: NAMES, render: render };
  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
