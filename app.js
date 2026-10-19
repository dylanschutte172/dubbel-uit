/* Dubbel Uit — schermen, invoer, bot-beurten en camera-koppeling. */
(function () {
  "use strict";

  var L = window.DartLogic;
  var V = window.DartVision;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = "http://www.w3.org/2000/svg";

  // ── Opslag (kan ontbreken in privévensters) ───────────────────────────
  var store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem("dubbeluit." + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem("dubbeluit." + key, JSON.stringify(value)); } catch (e) { /* geen opslag */ }
    },
    del: function (key) {
      try { localStorage.removeItem("dubbeluit." + key); } catch (e) { /* geen opslag */ }
    },
  };

  var settings = Object.assign({
    start: 501,
    out: "double",
    legs: 3,
    sets: 1,
    mode: "bot",
    me: "",
    botAvg: 60,
    first: "me",
    players: ["Speler 1", "Speler 2"],
    voice: true,
    inputMode: window.matchMedia && window.matchMedia("(max-width: 820px)").matches ? "keypad" : "board",
    camSens: 30,
    camId: "",
    train: "121",
    trainRange: "41-80",
    trainTurns: 3,
    train121Turns: 3,
    trainRounds: 10,
    atcMode: "any",
  }, store.get("settings", {}));
  // Versie 2: omroeper standaard aan, ook voor wie hem eerder uit had staan.
  if (settings.voiceV !== 2) { settings.voice = true; settings.voiceV = 2; }

  function saveSettings() { store.set("settings", settings); }

  var match = store.get("match", null);
  if (match && match.winner !== null) match = null;
  var lastSetup = store.get("lastSetup", null);
  var undoStack = [];
  var botBusy = false;
  var botTimer = null;
  var recentDarts = [];
  var kpValue = "";

  // ── Schermen ───────────────────────────────────────────────────────────
  var SCREENS = ["setup", "play", "result", "history", "atc"];

  function show(name) {
    SCREENS.forEach(function (s) { $("screen-" + s).hidden = s !== name; });
    document.querySelectorAll("[data-screen]").forEach(function (b) {
      var current = b.dataset.screen === name || ((name === "result" || name === "atc") && b.dataset.screen === "play");
      if (current) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (name === "setup") renderSetup();
    if (name === "play") render();
    if (name === "history") renderHistory();
    if (name === "atc") renderATC();
  }

  document.querySelectorAll("[data-screen]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.screen === "play" && !match) { show(atc && !atc.done ? "atc" : lastResult ? "result" : "setup"); return; }
      show(b.dataset.screen);
    });
  });

  // ── Omroeper ───────────────────────────────────────────────────────────
  var canSpeak = "speechSynthesis" in window;

  function syncVoice() {
    ["voice-toggle", "voice-toggle-2"].forEach(function (id) {
      $(id).setAttribute("aria-pressed", String(settings.voice));
      $(id).hidden = !canSpeak;
    });
    $("voice-label").textContent = settings.voice ? "Geluid aan" : "Geluid uit";
    $("voice-label-2").textContent = settings.voice ? "Geluid aan" : "Geluid uit";
  }
  function toggleVoice() {
    settings.voice = !settings.voice;
    saveSettings();
    syncVoice();
    if (settings.voice) say("Geluid aan");
  }
  $("voice-toggle").addEventListener("click", toggleVoice);
  $("voice-toggle-2").addEventListener("click", toggleVoice);

  var nlVoice = null;
  function pickVoice() {
    if (!canSpeak) return;
    var voices = speechSynthesis.getVoices();
    nlVoice = voices.filter(function (v) { return /^nl[-_]NL/i.test(v.lang); })[0] ||
      voices.filter(function (v) { return /^nl/i.test(v.lang); })[0] || null;
  }
  if (canSpeak) {
    pickVoice();
    speechSynthesis.addEventListener && speechSynthesis.addEventListener("voiceschanged", pickVoice);
    // Telefoons spreken pas na een eerste aanraking; ontgrendel de spraak daarmee.
    var unlock = function () {
      try {
        var u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch (e) { /* geen spraak */ }
      document.removeEventListener("pointerdown", unlock, true);
    };
    document.addEventListener("pointerdown", unlock, true);
  }

  function say() {
    // say("60", "Jij hebt 40 nodig"): zinnen worden na elkaar uitgesproken.
    if (!settings.voice || !canSpeak) return;
    var parts = Array.prototype.slice.call(arguments).filter(Boolean);
    try {
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      parts.forEach(function (text) {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "nl-NL";
        u.rate = 1.05;
        if (nlVoice) u.voice = nlVoice;
        speechSynthesis.speak(u);
      });
    } catch (e) { /* geen spraak */ }
  }

  var toastTimer = null;
  function toast(text) {
    var t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ── Instellen ──────────────────────────────────────────────────────────
  function bindSeg(id, key, parse) {
    $(id).addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      settings[key] = parse ? parse(b.dataset.v) : b.dataset.v;
      saveSettings();
      renderSetup();
    });
  }
  bindSeg("opt-start", "start", Number);
  bindSeg("opt-out", "out");
  bindSeg("opt-mode", "mode");
  bindSeg("opt-first", "first");
  bindSeg("opt-train", "train");
  bindSeg("opt-range", "trainRange");
  // 121 en uitgooien onthouden elk hun eigen aantal darts.
  $("opt-turns").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    settings[settings.train === "121" ? "train121Turns" : "trainTurns"] = Number(b.dataset.v);
    saveSettings();
    renderSetup();
  });
  bindSeg("opt-rounds", "trainRounds", Number);
  bindSeg("opt-atc", "atcMode");

  function pressSeg(id, value) {
    $(id).querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === String(value)));
    });
  }

  document.querySelectorAll("[data-step]").forEach(function (b) {
    b.addEventListener("click", function () {
      var key = b.dataset.step;
      settings[key] = Math.max(1, Math.min(key === "legs" ? 11 : 7, settings[key] + Number(b.dataset.d)));
      saveSettings();
      renderSetup();
    });
  });

  L.BOT_LEVELS.forEach(function (lvl) {
    var b = document.createElement("button");
    b.type = "button";
    b.dataset.avg = lvl.avg;
    b.innerHTML = "<b></b><span></span>";
    b.querySelector("b").textContent = lvl.name;
    b.querySelector("span").textContent = "gem. ± " + lvl.avg;
    b.addEventListener("click", function () {
      settings.botAvg = lvl.avg;
      saveSettings();
      renderSetup();
    });
    $("levels").appendChild(b);
  });

  $("bot-avg").addEventListener("input", function () {
    settings.botAvg = Number(this.value);
    saveSettings();
    renderSetup();
  });
  $("me-name").addEventListener("input", function () {
    settings.me = this.value;
    saveSettings();
  });

  function levelName(avg) {
    var best = L.BOT_LEVELS[0];
    L.BOT_LEVELS.forEach(function (l) { if (Math.abs(l.avg - avg) < Math.abs(best.avg - avg)) best = l; });
    return best.avg === avg ? best.name : "Gem. " + avg;
  }

  function renderPlayers() {
    var list = $("players-list");
    list.textContent = "";
    settings.players.forEach(function (name, i) {
      var row = document.createElement("div");
      row.className = "row";
      var input = document.createElement("input");
      input.type = "text";
      input.id = "player-" + i;
      input.maxLength = 20;
      input.value = name;
      input.setAttribute("aria-label", "Naam speler " + (i + 1));
      input.addEventListener("input", function () {
        settings.players[i] = input.value;
        saveSettings();
      });
      row.appendChild(input);
      if (settings.players.length > 1) {
        var del = document.createElement("button");
        del.type = "button";
        del.className = "btn";
        del.textContent = "Weg";
        del.setAttribute("aria-label", "Speler " + (i + 1) + " verwijderen");
        del.addEventListener("click", function () {
          settings.players.splice(i, 1);
          saveSettings();
          renderPlayers();
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    });
    $("add-player").hidden = settings.players.length >= 6;
  }
  $("add-player").addEventListener("click", function () {
    settings.players.push("Speler " + (settings.players.length + 1));
    saveSettings();
    renderPlayers();
  });

  function renderSetup() {
    pressSeg("opt-start", settings.start);
    pressSeg("opt-out", settings.out);
    pressSeg("opt-mode", settings.mode);
    pressSeg("opt-first", settings.first);
    $("out-legs").textContent = settings.legs;
    $("out-sets").textContent = settings.sets;
    $("format-text").textContent = settings.sets > 1
      ? "Best of " + (2 * settings.sets - 1) + " sets, elke set best of " + (2 * settings.legs - 1) + " legs"
      : "Best of " + (2 * settings.legs - 1) + " legs";
    var training = settings.mode === "training";
    $("bot-options").hidden = settings.mode !== "bot";
    $("player-options").hidden = settings.mode !== "players";
    $("me-field").hidden = settings.mode === "players";
    $("training-options").hidden = !training;
    $("game-options").hidden = training;
    pressSeg("opt-train", settings.train);
    pressSeg("opt-range", settings.trainRange);
    pressSeg("opt-turns", settings.train === "121" ? settings.train121Turns : settings.trainTurns);
    pressSeg("opt-rounds", settings.trainRounds);
    pressSeg("opt-atc", settings.atcMode);
    $("train-range").hidden = settings.train !== "checkout";
    $("train-turns").hidden = settings.train === "atc";
    $("train-rounds").hidden = settings.train === "atc";
    $("train-atc").hidden = settings.train !== "atc";
    $("start-btn").textContent = training ? "Start training" : "Start wedstrijd";
    $("me-name").value = settings.me;
    $("bot-avg").value = settings.botAvg;
    $("bot-avg-out").textContent = settings.botAvg;
    $("levels").querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.avg) === settings.botAvg));
    });
    renderPlayers();
    $("resume-btn").hidden = !match;
  }

  function buildConfig() {
    var players;
    var first = 0;
    if (settings.mode === "bot") {
      players = [
        { name: settings.me.trim() || "Jij" },
        { name: "Bot", bot: { avg: settings.botAvg, level: levelName(settings.botAvg) } },
      ];
      first = settings.first === "bot" ? 1 : settings.first === "random" ? Math.floor(Math.random() * 2) : 0;
    } else {
      players = settings.players.map(function (n, i) { return { name: n.trim() || "Speler " + (i + 1) }; });
    }
    return {
      start: settings.start,
      legs: settings.legs,
      sets: settings.sets,
      doubleOut: settings.out === "double",
      first: first,
      players: players,
    };
  }

  function startMatch(cfg) {
    cancelBot();
    match = L.createMatch(cfg);
    lastSetup = cfg;
    store.set("lastSetup", cfg);
    undoStack = [];
    recentDarts = [];
    kpValue = "";
    lastResult = null;
    persist();
    show("play");
    say("Game on!");
    maybeBot();
  }

  // Wedstrijd stoppen (met bevestiging op de pagina zelf).
  $("stop-btn").addEventListener("click", function () { $("stop-ask").hidden = false; });
  $("stop-no").addEventListener("click", function () { $("stop-ask").hidden = true; });
  $("stop-yes").addEventListener("click", function () {
    $("stop-ask").hidden = true;
    cancelBot();
    if (stream) stopCamera();
    if (match && match.training && match.training.results.length) saveTraining(match.training);
    match = null;
    undoStack = [];
    recentDarts = [];
    persist();
    show("setup");
  });

  $("start-btn").addEventListener("click", function () {
    if (settings.mode === "training") startTraining();
    else startMatch(buildConfig());
  });

  // ── Training: 121 en uitgooien (gespeeld als korte legs), Around the Clock ──
  function myName() { return (settings.me || "").trim() || "Jij"; }

  function startTraining() {
    if (settings.train === "atc") { startATC(); return; }
    var range = settings.trainRange.split("-").map(Number);
    var t = L.createTraining(settings.train, {
      min: range[0], max: range[1], rounds: settings.trainRounds,
      turns: settings.train === "121" ? settings.train121Turns : settings.trainTurns,
    });
    t.name = myName();
    startRound(t, settings.train === "121" ? "121" : "Uitgooi-training");
  }

  function startRound(t, intro) {
    cancelBot();
    match = L.createMatch({ start: t.target, legs: 1, sets: 1, doubleOut: true, players: [{ name: t.name }] });
    match.training = t;
    undoStack = [];
    recentDarts = [];
    kpValue = "";
    lastResult = null;
    atc = null;
    store.del("atc");
    persist();
    show("play");
    say(intro, "Gooi " + t.target + " uit");
  }

  function trainingStep(ev) {
    var t = match.training;
    var finished = ev.type === "leg" || ev.type === "set" || ev.type === "match";
    var turns = match.leg.turns;
    if (!finished && turns.length < t.maxTurns) {
      var last = turns[turns.length - 1];
      recentDarts = last ? last.darts : [];
      var left = match.leg.rem[0];
      if (ev.type === "bust") { say("Geen score", "nog " + left); toast("Bust · nog " + left); }
      else { say(String(ev.score), "nog " + left); toast(ev.score + " · nog " + left); }
      persist();
      render();
      return;
    }
    var darts = match.players[0].stats.darts;
    var target = t.target;
    L.trainingResult(t, finished, darts);
    toast(finished ? target + " uit in " + darts + " darts!" : target + " niet gelukt");
    if (t.done) {
      say(finished ? "Gelukt!" : "Helaas");
      finishTraining(t);
      return;
    }
    startRound(t, finished ? "Gelukt!" : "Helaas");
  }

  function saveTraining(t) {
    var ok = (t.results || []).filter(function (r) { return r.ok; });
    var entry = {
      type: t.type, name: t.name, date: Date.now(), rounds: (t.results || []).length, ok: ok.length,
      darts: ok.reduce(function (sum, r) { return sum + r.darts; }, 0),
    };
    if (t.type === "121") { entry.best = t.best; entry.locked = t.locked; }
    if (t.type === "checkout") { entry.min = t.min; entry.max = t.max; entry.turns = t.maxTurns; }
    if (t.type === "atc") { entry = { type: "atc", name: t.name, date: Date.now(), mode: t.mode, darts: t.darts, hits: t.hits, done: t.done, secs: Math.round(((t.endedAt || Date.now()) - t.startedAt) / 1000) }; }
    var list = store.get("training", []);
    list.unshift(entry);
    store.set("training", list.slice(0, 300));
  }

  function finishTraining(t) {
    cancelBot();
    saveTraining(t);
    lastResult = { training: t };
    match = null;
    persist();
    renderTrainingResult(t);
    show("result");
  }

  function renderTrainingResult(t) {
    var ok = (t.results || []).filter(function (r) { return r.ok; });
    var sub = $("result-sub");
    sub.hidden = false;
    if (t.type === "atc") {
      $("result-title").textContent = t.done ? "Rondje klaar!" : "Around the Clock";
      sub.textContent = t.darts + " darts · " + Math.round((t.hits / Math.max(1, t.darts)) * 100) + "% raak";
    } else if (t.type === "121") {
      $("result-title").textContent = t.best ? "121: hoogste " + t.best : "121";
      sub.textContent = ok.length + " van " + t.results.length + " gelukt · veilige stand " + t.locked;
    } else {
      $("result-title").textContent = ok.length + " van " + t.results.length + " uitgegooid";
      sub.textContent = Math.round((ok.length / Math.max(1, t.results.length)) * 100) + "% gelukt · finishes " + t.min + "–" + t.max;
    }
    var tbl = $("result-table");
    tbl.textContent = "";
    if (t.type === "atc") {
      var rows = [["Darts", t.darts], ["Raak", t.hits + " van " + t.darts], ["Tijd", Math.floor(((t.endedAt || Date.now()) - t.startedAt) / 60000) + " min"]];
      var tb = document.createElement("tbody");
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        var th = document.createElement("th"); th.scope = "row"; th.textContent = r[0];
        var td = document.createElement("td"); td.textContent = r[1];
        tr.append(th, td); tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      return;
    }
    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Ronde</th><th>Finish</th><th>Resultaat</th></tr>";
    tbl.appendChild(thead);
    var body = document.createElement("tbody");
    t.results.forEach(function (r, i) {
      var tr = document.createElement("tr");
      [String(i + 1), String(r.target), r.ok ? "Uit in " + r.darts + " darts" : "Niet gelukt"].forEach(function (v, k) {
        var c = document.createElement(k === 0 ? "th" : "td");
        if (k === 0) c.scope = "row";
        c.textContent = v;
        tr.appendChild(c);
      });
      body.appendChild(tr);
    });
    tbl.appendChild(body);
  }

  // Around the Clock
  var atc = store.get("atc", null);
  var atcUndo = [];

  function startATC() {
    cancelBot();
    match = null;
    persist();
    atc = L.createATC(settings.atcMode);
    atc.name = myName();
    atcUndo = [];
    lastResult = null;
    store.set("atc", atc);
    show("atc");
    sayTarget("Around the Clock. Gooi op");
  }

  function spokenTarget() {
    var t = L.atcTarget(atc);
    if (t.num === 25) return "de bull";
    return (atc.mode === "double" ? "dubbel " : atc.mode === "treble" ? "triple " : "") + t.num;
  }

  function sayTarget(prefix) { say((prefix ? prefix + " " : "") + spokenTarget()); }

  function renderATC() {
    if (!atc) return;
    var t = L.atcTarget(atc);
    $("atc-mode").textContent = "Around the Clock · " + (atc.mode === "double" ? "alleen dubbels" : atc.mode === "treble" ? "alleen triples" : "elk vak");
    $("atc-target").textContent = t.num === 25 ? "Bull" : t.label;
    $("atc-bar").style.width = Math.round((atc.idx / L.ATC_TARGETS.length) * 100) + "%";
    $("atc-progress").textContent = atc.idx + " van " + L.ATC_TARGETS.length;
    $("atc-darts").textContent = atc.darts + " darts";
    $("atc-rate").textContent = atc.darts ? Math.round((atc.hits / atc.darts) * 100) + "% raak" : "";
    $("atc-undo").disabled = !atcUndo.length;
  }

  function atcThrow(hit) {
    if (!atc || atc.done) return;
    atcUndo.push(JSON.stringify(atc));
    L.atcThrow(atc, hit);
    store.set("atc", atc);
    if (atc.done) {
      say("Klaar! " + atc.darts + " darts");
      store.del("atc");
      lastResult = { training: atc };
      saveTraining(atc);
      renderTrainingResult(atc);
      atc = null;
      show("result");
      return;
    }
    if (hit) sayTarget();
    renderATC();
  }
  $("atc-hit").addEventListener("click", function () { atcThrow(true); });
  $("atc-miss").addEventListener("click", function () { atcThrow(false); });
  $("atc-undo").addEventListener("click", function () {
    if (!atcUndo.length) return;
    atc = JSON.parse(atcUndo.pop());
    store.set("atc", atc);
    renderATC();
  });
  $("atc-stop").addEventListener("click", function () { $("atc-stop-ask").hidden = false; });
  $("atc-stop-no").addEventListener("click", function () { $("atc-stop-ask").hidden = true; });
  $("atc-stop-yes").addEventListener("click", function () {
    $("atc-stop-ask").hidden = true;
    atc = null;
    store.del("atc");
    show("setup");
  });
  $("resume-btn").addEventListener("click", function () { show("play"); maybeBot(); });

  // ── Dartbord ───────────────────────────────────────────────────────────
  var boardSvg = $("board");
  var markerLayer;

  function svgPoint(r, deg) {
    var p = L.polarToXY(r, deg);
    return (p.x).toFixed(2) + " " + (-p.y).toFixed(2);
  }

  function sector(r0, r1, a0, a1) {
    return "M" + svgPoint(r1, a0) + " A" + r1 + " " + r1 + " 0 0 1 " + svgPoint(r1, a1) +
      " L" + svgPoint(r0, a1) + " A" + r0 + " " + r0 + " 0 0 0 " + svgPoint(r0, a0) + " Z";
  }

  function el(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  function buildBoard() {
    var R = L.R;
    el("circle", { r: 226, fill: "#0b0d0c" }, boardSvg);
    el("circle", { r: R.doubleOut + 1.5, fill: "#2a2a27" }, boardSvg);
    var g = el("g", { stroke: "#a7aca7", "stroke-width": 0.7, "stroke-opacity": 0.55 }, boardSvg);
    L.ORDER.forEach(function (num, i) {
      var a0 = i * 18 - 9, a1 = i * 18 + 9;
      var dark = i % 2 === 0;
      var single = dark ? "var(--board-dark)" : "var(--board-light)";
      var ring = dark ? "var(--red)" : "var(--green)";
      el("path", { d: sector(R.outerBull, R.trebleIn, a0, a1), fill: single, class: "seg-hit" }, g);
      el("path", { d: sector(R.trebleIn, R.trebleOut, a0, a1), fill: ring, class: "seg-hit" }, g);
      el("path", { d: sector(R.trebleOut, R.doubleIn, a0, a1), fill: single, class: "seg-hit" }, g);
      el("path", { d: sector(R.doubleIn, R.doubleOut, a0, a1), fill: ring, class: "seg-hit" }, g);
      var tp = L.polarToXY(197, i * 18);
      var t = el("text", {
        x: tp.x.toFixed(1), y: (-tp.y + 9).toFixed(1), "text-anchor": "middle",
        fill: "var(--fg)", "font-family": "var(--font-display)", "font-weight": 700, "font-size": 27,
        stroke: "none",
      }, boardSvg);
      t.textContent = num;
    });
    el("circle", { r: R.outerBull, fill: "var(--green)", class: "seg-hit" }, g);
    el("circle", { r: R.bull, fill: "var(--red)", class: "seg-hit" }, g);
    markerLayer = el("g", {}, boardSvg);
  }

  function boardCoords(evt) {
    var pt = boardSvg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    var p = pt.matrixTransform(boardSvg.getScreenCTM().inverse());
    return { x: p.x, y: -p.y };
  }

  boardSvg.addEventListener("click", function (evt) {
    if (!canInput()) return;
    var c = boardCoords(evt);
    var hit = L.scoreAt(c.x, c.y);
    hit.x = c.x;
    hit.y = c.y;
    humanDart(hit);
  });

  function renderMarkers() {
    markerLayer.textContent = "";
    var darts = match && match.leg.turn.darts.length ? match.leg.turn.darts : recentDarts;
    darts.forEach(function (d, i) {
      if (d.x === undefined) return;
      var g = el("g", { class: "marker" }, markerLayer);
      el("circle", { cx: d.x.toFixed(1), cy: (-d.y).toFixed(1), r: 7, fill: "var(--accent)", stroke: "#000", "stroke-width": 1.5 }, g);
      var t = el("text", {
        x: d.x.toFixed(1), y: (-d.y + 4).toFixed(1), "text-anchor": "middle", "font-size": 10, "font-weight": 700, fill: "#000",
      }, g);
      t.textContent = i + 1;
    });
  }

  // ── Wedstrijd tonen ────────────────────────────────────────────────────
  function canInput() {
    return !!match && match.winner === null && !match.players[match.leg.current].bot && !botBusy;
  }

  function lastScoreOf(idx) {
    var turns = match.leg.turns;
    for (var i = turns.length - 1; i >= 0; i--) {
      if (turns[i].player === idx) return turns[i].bust ? "Bust" : String(turns[i].total);
    }
    return "–";
  }

  function render() {
    if (!match) return;
    var leg = match.leg;
    var sb = $("scoreboard");
    sb.textContent = "";
    match.players.forEach(function (p, i) {
      var card = document.createElement("div");
      var active = match.winner === null && leg.current === i;
      card.className = "pcard" + (active ? " active" : "") + (match.legStarter === i ? " starter" : "");
      var rem = active ? L.currentRem(match) : leg.rem[i];
      var setsLine = match.cfg.sets > 1
        ? "<span>Sets <b>" + p.stats.setsWon + "</b></span><span>Legs <b>" + match.legsInSet[i] + "</b></span>"
        : "<span>Legs <b>" + match.legsInSet[i] + "</b></span>";
      card.innerHTML =
        '<div class="who"><span class="dot" title="Begon deze leg"></span><b></b>' + (p.bot ? '<span class="tag"></span>' : "") + "</div>" +
        '<div class="rem num"></div>' +
        '<div class="legs">' + setsLine + "</div>" +
        '<div class="meta"><span>Gem. <b class="num"></b></span><span>Laatste <b class="num"></b></span><span>180s <b class="num"></b></span></div>';
      card.querySelector(".who b").textContent = p.name;
      if (p.bot) card.querySelector(".tag").textContent = "Bot · " + p.bot.avg;
      card.querySelector(".rem").textContent = rem;
      var metas = card.querySelectorAll(".meta b");
      metas[0].textContent = L.threeDartAverage(p.stats).toFixed(1);
      metas[1].textContent = lastScoreOf(i);
      metas[2].textContent = p.stats.s180;
      sb.appendChild(card);
    });

    var cur = match.players[leg.current];
    $("who-turn").textContent = match.winner !== null ? match.players[match.winner].name + " wint!" : cur.name + (cur.bot ? " gooit…" : " gooit");
    $("leg-info").textContent = (match.cfg.sets > 1 ? "Set " + match.setNo + " · " : "") + "Leg " + match.legNo + " · " + match.cfg.start + (match.cfg.doubleOut ? " dubbel uit" : "");
    if (match.training) {
      var tr = match.training;
      $("who-turn").textContent = (tr.type === "121" ? "121" : "Uitgooien") + " · ronde " + tr.round + "/" + tr.rounds;
      $("leg-info").textContent = "Beurt " + Math.min(tr.maxTurns, leg.turns.length + 1) + " van " + tr.maxTurns + (tr.type === "121" ? " · veilig " + tr.locked : "");
    }

    var remNow = L.currentRem(match);
    var route = match.cfg.doubleOut && match.winner === null ? L.checkout(remNow, 3 - leg.turn.darts.length) : null;
    $("checkout").hidden = !route;
    var rr = $("checkout-route");
    rr.textContent = "";
    (route || []).forEach(function (d, i, arr) {
      var s = document.createElement("span");
      s.textContent = d.label;
      if (i === arr.length - 1) s.className = "d";
      rr.appendChild(s);
    });

    var turn = $("turn");
    turn.textContent = "";
    // Is de beurt nog leeg, toon dan (vaag) de vorige beurt, bijvoorbeeld wat de bot gooide.
    var shown = leg.turn.darts.length ? leg.turn.darts : recentDarts;
    turn.classList.toggle("prev", !leg.turn.darts.length && recentDarts.length > 0);
    var sum = 0;
    for (var k = 0; k < 3; k++) {
      var slot = document.createElement("div");
      var d = shown[k];
      slot.className = "slot" + (d ? " filled" + (d.mult === 2 ? " d" : d.mult === 3 ? " t" : "") : "");
      slot.textContent = d ? d.label : "";
      if (d) sum += d.score;
      turn.appendChild(slot);
    }
    var sumEl = document.createElement("div");
    sumEl.className = "sum num";
    sumEl.textContent = sum;
    turn.appendChild(sumEl);

    var locked = !canInput();
    $("board-wrap").classList.toggle("locked", locked);
    $("board-hint").textContent = botBusy || (match.winner === null && cur.bot) ? "De bot is aan de beurt" : "Tik op het bord waar je dart zit";
    ["miss-btn", "miss-btn-2"].forEach(function (id) { $(id).disabled = locked; });
    ["undo-btn", "undo-btn-2", "undo-btn-3"].forEach(function (id) { $(id).disabled = !undoStack.length; });

    renderMode();
    renderMarkers();
    drawOverlay();
  }

  // ── Invoer ─────────────────────────────────────────────────────────────
  function persist() {
    store.set("match", match && match.winner === null ? match : null);
  }

  function pushUndo() {
    undoStack.push(JSON.stringify({ match: match, recent: recentDarts }));
    if (undoStack.length > 60) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) return;
    cancelBot();
    var snap = JSON.parse(undoStack.pop());
    match = snap.match;
    recentDarts = snap.recent;
    kpValue = "";
    $("finish-ask").hidden = true;
    awaitingPull = false;
    persist();
    if (lastResult) { lastResult = null; show("play"); }
    render();
    maybeBot();
  }
  ["undo-btn", "undo-btn-2", "undo-btn-3"].forEach(function (id) { $(id).addEventListener("click", undo); });

  function humanDart(d) {
    if (!canInput()) return;
    pushUndo();
    recentDarts = [];
    var ev = L.addDart(match, d);
    if (ev) cameraTurnEnded();
    afterEvent(ev);
  }

  function miss() { humanDart(L.dart(0, 0)); }
  $("miss-btn").addEventListener("click", miss);
  $("miss-btn-2").addEventListener("click", miss);

  function afterEvent(ev) {
    if (ev && match.training) { trainingStep(ev); return; }
    if (ev) {
      var turns = match.leg.turns;
      var last = turns[turns.length - 1];
      if (ev.type === "turn" || ev.type === "bust") recentDarts = last ? last.darts : [];
      var p = match.players[ev.player];
      if (ev.type === "bust" || ev.type === "turn") {
        var next = match.players[match.leg.current];
        var nextRem = match.leg.rem[match.leg.current];
        var need = match.cfg.doubleOut && L.checkout(nextRem, 3) ? next.name + ", je hebt " + nextRem + " nodig" : "";
        if (ev.type === "bust") {
          say("Geen score", need);
          toast(p.name + ": bust");
        } else {
          say(ev.score === 180 ? "Honderdtachtig!" : String(ev.score), need);
          toast(p.name + ": " + ev.score + (ev.score === 180 ? "!" : "") + " · nog " + match.leg.rem[ev.player]);
        }
      } else {
        recentDarts = [];
        var what = ev.type === "match" ? "de wedstrijd" : ev.type === "set" ? "de set" : "de leg";
        say("Game shot, en " + what + " voor " + p.name);
        toast(p.name + " wint " + what + (ev.score ? " (" + ev.score + " uit)" : ""));
      }
    }
    persist();
    if (match.winner !== null) { finishMatch(); return; }
    render();
    maybeBot();
  }

  // Cijfers
  var PRESETS = [26, 45, 60, 81, 85, 100, 41, 121, 140, 180];
  PRESETS.forEach(function (n) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = n;
    b.addEventListener("click", function () { kpValue = String(n); renderKeypad(); });
    $("presets").appendChild(b);
  });
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "UNDO", "0", "OK"].forEach(function (k) {
    if (k === "UNDO") {
      // Herstel onderaan het toetsenblok, waar je duim zit.
      $("keypad").appendChild($("undo-btn-2"));
      return;
    }
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = k;
    if (k === "OK") b.className = "ok";
    b.setAttribute("aria-label", k === "⌫" ? "Wissen" : k === "OK" ? "Score invoeren" : k);
    b.addEventListener("click", function () { keypadPress(k); });
    $("keypad").appendChild(b);
  });

  $("finish-cancel").addEventListener("click", function () { $("finish-ask").hidden = true; });
  $("finish-ask").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });

  $("kp-back").addEventListener("click", function () { keypadPress("⌫"); });

  function keypadPress(k) {
    if (!canInput()) return;
    $("finish-ask").hidden = true;
    if (k === "⌫") kpValue = kpValue.slice(0, -1);
    else if (k === "OK") { submitTotal(); return; }
    else if (kpValue.length < 3) kpValue = (kpValue === "0" ? "" : kpValue) + k;
    renderKeypad();
  }

  document.addEventListener("keydown", function (e) {
    if ($("screen-play").hidden || settings.inputMode !== "keypad" || /INPUT|SELECT/.test(e.target.tagName)) return;
    if (/^[0-9]$/.test(e.key)) keypadPress(e.key);
    else if (e.key === "Backspace") keypadPress("⌫");
    else if (e.key === "Enter") keypadPress("OK");
  });

  function renderKeypad() {
    $("kp-display").textContent = kpValue || "0";
  }

  // Keuze-popup: ask("Titel", "Vraag", [{ big: "2", small: "darts", value: 2 }], function (value) {...})
  function ask(title, question, options, onPick, compact) {
    $("finish-title").textContent = title;
    $("finish-q").textContent = question;
    var box = $("finish-darts");
    box.textContent = "";
    box.classList.toggle("compact", !!compact);
    options.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      var big = document.createElement("b");
      big.textContent = o.big;
      b.appendChild(big);
      if (o.small) b.appendChild(document.createTextNode(o.small));
      b.addEventListener("click", function () {
        $("finish-ask").hidden = true;
        onPick(o.value);
      });
      box.appendChild(b);
    });
    $("finish-ask").hidden = false;
    box.querySelector("button").focus();
  }

  function dartOptions(from, to) {
    var out = [];
    for (var n = from; n <= to; n++) out.push({ big: String(n), small: n === 1 ? "dart" : "darts", value: n });
    return out;
  }

  function commitTotal(total, dartsToFinish, dblDarts, finishDouble) {
    pushUndo();
    kpValue = "";
    renderKeypad();
    recentDarts = [];
    afterEvent(L.addTurnTotal(match, total, dartsToFinish, dblDarts, finishDouble));
  }

  // Welke dubbels kunnen de laatste dart zijn geweest bij `rem` in `n` darts?
  var ONE_DART = (function () {
    var set = { 0: true, 25: true, 50: true };
    for (var i = 1; i <= 20; i++) { set[i] = true; set[2 * i] = true; set[3 * i] = true; }
    return Object.keys(set).map(Number);
  })();

  function reachable(v, k) {
    if (k === 0) return v === 0;
    return ONE_DART.some(function (d) { return d <= v && reachable(v - d, k - 1); });
  }

  function askFinishDouble(rem, n, done) {
    var opts = [];
    for (var i = 20; i >= 1; i--) if (2 * i <= rem && reachable(rem - 2 * i, n - 1)) opts.push({ big: "D" + i, value: "D" + i });
    if (rem >= 50 && reachable(rem - 50, n - 1)) opts.push({ big: "Bull", value: "Bull" });
    if (opts.length <= 1) { done(opts.length ? opts[0].value : undefined); return; }
    opts.push({ big: "?", small: "", value: undefined });
    ask("Welke dubbel?", "Op welke dubbel ging hij uit? (? = weet ik niet)", opts, done, true);
  }

  function submitTotal() {
    if (!canInput()) return;
    if (match.leg.turn.darts.length) {
      toast("Maak eerst deze beurt af op het bord");
      return;
    }
    var total = Number(kpValue || "0");
    if (!L.isPossibleTurnTotal(total)) {
      toast(total + " kan niet met 3 darts");
      return;
    }
    var rem = match.leg.turn.start;
    var dbl = match.cfg.doubleOut;
    // Dubbel-vragen alleen in wedstrijden; trainingen tellen daar niet voor mee.
    var track = dbl && !match.training;
    if (total === rem && rem > 0) {
      var minDarts = dbl ? (L.checkout(rem, 1) ? 1 : L.checkout(rem, 2) ? 2 : L.checkout(rem, 3) ? 3 : 0) : Math.ceil(rem / 60);
      if (!minDarts) {
        toast(rem + " kun je niet uitgooien");
        return;
      }
      ask("Uitgegooid!", "In hoeveel darts?", dartOptions(minDarts, 3), function (n) {
        if (!track || n === 1) { commitTotal(total, n, dbl ? 1 : 0); return; }
        // Voor je uitgooipercentage: hoeveel van die darts gingen naar een dubbel? En welke dubbel?
        ask("Op de dubbel", "Hoeveel darts gooide je op een dubbel?", dartOptions(1, n), function (d) {
          askFinishDouble(rem, n, function (fd) { commitTotal(total, n, d, fd); });
        });
      });
      return;
    }
    // Stond je op een uitgooi (50 of minder) en ging hij er niet uit? Vraag de darts op de dubbel.
    if (track && rem <= 50 && L.checkout(rem, 3)) {
      var opts = dartOptions(0, 3);
      opts[0].small = "geen";
      ask("Op de dubbel", "Hoeveel darts gooide je op een dubbel?", opts, function (d) {
        commitTotal(total, undefined, d);
      });
      return;
    }
    commitTotal(total);
  }

  // Invoermodus
  document.querySelectorAll("[data-mode]").forEach(function (b) {
    b.addEventListener("click", function () {
      settings.inputMode = b.dataset.mode;
      saveSettings();
      renderMode();
      drawOverlay();
    });
  });

  function renderMode() {
    document.body.dataset.input = settings.inputMode;
    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === settings.inputMode));
    });
    $("mode-board").hidden = settings.inputMode !== "board";
    $("mode-keypad").hidden = settings.inputMode !== "keypad";
    $("mode-camera").hidden = settings.inputMode !== "camera";
    renderKeypad();
  }

  // ── Bot ────────────────────────────────────────────────────────────────
  function cancelBot() {
    clearTimeout(botTimer);
    botTimer = null;
    botBusy = false;
  }

  function maybeBot() {
    if (!match || match.winner !== null || botBusy) return;
    var p = match.players[match.leg.current];
    if (!p.bot || $("screen-play").hidden) return;
    botBusy = true;
    render();
    botTimer = setTimeout(botStep, 900);
  }

  function botStep() {
    var p = match.players[match.leg.current];
    var rem = L.currentRem(match);
    var left = 3 - match.leg.turn.darts.length;
    var hit = L.botThrow(L.botAim(rem, left, match.cfg.doubleOut), p.bot.sigma);
    recentDarts = [];
    var ev = L.addDart(match, hit);
    if (ev) {
      botBusy = false;
      botTimer = null;
      afterEvent(ev);
      return;
    }
    render();
    botTimer = setTimeout(botStep, 750);
  }

  // ── Uitslag & geschiedenis ─────────────────────────────────────────────
  var lastResult = null;

  function finishMatch() {
    cancelBot();
    lastResult = match;
    var entry = {
      v: 2,
      date: match.endedAt || Date.now(),
      start: match.cfg.start,
      legs: match.cfg.legs,
      sets: match.cfg.sets,
      doubleOut: match.cfg.doubleOut,
      winner: match.winner,
      players: match.players.map(function (p, i) {
        var st = p.stats;
        return {
          name: p.name,
          bot: p.bot ? p.bot.avg : null,
          won: i === match.winner,
          avg: Math.round(L.threeDartAverage(st) * 10) / 10,
          sets: st.setsWon,
          legs: st.legsWon,
          legsPlayed: st.legsPlayed,
          points: st.points,
          darts: st.darts,
          f9Points: st.f9Points,
          f9Darts: st.f9Darts,
          dblDarts: st.dblDarts,
          dblHits: st.dblHits,
          s180: st.s180,
          s140: st.s140,
          s100: st.s100,
          highOut: st.highOut,
          bestLeg: st.bestLeg,
          doubles: st.doubles || {},
        };
      }),
    };
    var hist = store.get("history", []);
    hist.unshift(entry);
    store.set("history", hist.slice(0, 100));
    match = null;
    persist();
    renderResult();
    show("result");
  }

  function pct(stats) {
    var c = L.checkoutPercentage(stats);
    return c === null ? "–" : Math.round(c) + "% (" + stats.dblHits + "/" + stats.dblDarts + ")";
  }

  function renderResult() {
    var m = lastResult;
    $("result-sub").hidden = true;
    var w = m.players[m.winner];
    $("result-title").textContent = w.bot ? "De bot wint" : w.name + " wint!";
    var rows = [
      [m.cfg.sets > 1 ? "Sets" : "Legs", function (p) { return m.cfg.sets > 1 ? p.stats.setsWon : p.stats.legsWon; }],
      ["Gemiddelde", function (p) { return L.threeDartAverage(p.stats).toFixed(1); }],
      ["First 9", function (p) { return L.firstNineAverage(p.stats).toFixed(1); }],
      ["Uitgooi %", function (p) { return m.cfg.doubleOut ? pct(p.stats) : "–"; }],
      ["Hoogste uit", function (p) { return p.stats.highOut || "–"; }],
      ["Snelste leg", function (p) { return p.stats.bestLeg ? p.stats.bestLeg + " darts" : "–"; }],
      ["180", function (p) { return p.stats.s180; }],
      ["140+", function (p) { return p.stats.s140; }],
      ["100+", function (p) { return p.stats.s100; }],
      ["Beste beurt", function (p) { return p.stats.best; }],
      ["Darts", function (p) { return p.stats.darts; }],
    ];
    var t = $("result-table");
    t.textContent = "";
    var thead = document.createElement("thead");
    var trh = document.createElement("tr");
    trh.appendChild(document.createElement("th"));
    m.players.forEach(function (p) {
      var th = document.createElement("th");
      th.textContent = p.name;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    t.appendChild(thead);
    var tbody = document.createElement("tbody");
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      var th = document.createElement("th");
      th.scope = "row";
      th.textContent = r[0];
      tr.appendChild(th);
      m.players.forEach(function (p) {
        var td = document.createElement("td");
        td.textContent = r[1](p);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
  }

  $("rematch-btn").addEventListener("click", function () {
    if (lastResult && lastResult.training) {
      if (lastResult.training.type === "atc") { settings.atcMode = lastResult.training.mode; startATC(); }
      else startTraining();
      return;
    }
    if (!lastSetup) { show("setup"); return; }
    var cfg = JSON.parse(JSON.stringify(lastSetup));
    cfg.first = (cfg.first + 1) % cfg.players.length;
    startMatch(cfg);
  });
  $("new-btn").addEventListener("click", function () { show("setup"); });

  // ── Statistiek ─────────────────────────────────────────────────────────
  var DAY = 86400000;

  function keyOf(name) { return String(name || "").trim().toLowerCase(); }

  function humanNames(hist) {
    // Alle menselijke spelers, vaakst gespeeld eerst.
    var count = {};
    var shown = {};
    hist.forEach(function (h) {
      h.players.forEach(function (p) {
        if (p.bot) return;
        var k = keyOf(p.name);
        count[k] = (count[k] || 0) + 1;
        if (!shown[k]) shown[k] = p.name;
      });
    });
    return Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).map(function (k) { return { key: k, name: shown[k] }; });
  }

  function entriesFor(hist, key, from, to) {
    return hist.filter(function (h) { return h.date >= from && h.date < to; })
      .map(function (h) {
        var me = h.players.filter(function (p) { return !p.bot && keyOf(p.name) === key; })[0];
        return me ? { h: h, me: me } : null;
      })
      .filter(Boolean);
  }

  function aggregate(rows) {
    var a = { matches: rows.length, wins: 0, points: 0, darts: 0, f9Points: 0, f9Darts: 0, dblDarts: 0, dblHits: 0,
      s180: 0, s140: 0, s100: 0, highOut: 0, bestLeg: 0, legsWon: 0, legsPlayed: 0 };
    rows.forEach(function (r) {
      var p = r.me;
      var won = p.won !== undefined ? p.won : r.h.players[r.h.winner] === p;
      if (won) a.wins++;
      ["points", "darts", "f9Points", "f9Darts", "dblDarts", "dblHits", "s180", "s140", "s100", "legsPlayed"].forEach(function (k) {
        a[k] += p[k] || 0;
      });
      if (p.legsPlayed) a.legsWon += p.legs || 0;
      if ((p.highOut || 0) > a.highOut) a.highOut = p.highOut;
      if (p.bestLeg && (!a.bestLeg || p.bestLeg < a.bestLeg)) a.bestLeg = p.bestLeg;
    });
    a.avg = a.darts ? (a.points / a.darts) * 3 : null;
    a.f9 = a.f9Darts ? (a.f9Points / a.f9Darts) * 3 : null;
    a.co = a.dblDarts ? (a.dblHits / a.dblDarts) * 100 : null;
    return a;
  }

  function fmt1(v) { return v === null || v === undefined ? "–" : v.toFixed(1).replace(".", ","); }

  $("st-period").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    settings.statsDays = Number(b.dataset.v);
    saveSettings();
    renderHistory();
  });
  $("st-player").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    settings.statsPlayer = b.dataset.v;
    saveSettings();
    renderHistory();
  });

  function renderHistory() {
    var hist = store.get("history", []);
    var names = humanNames(hist);
    var days = settings.statsDays === undefined ? 30 : settings.statsDays;
    pressSeg("st-period", days);

    var key = settings.statsPlayer;
    if (!names.some(function (n) { return n.key === key; })) {
      var mine = keyOf(settings.me || "Jij");
      key = names.some(function (n) { return n.key === mine; }) ? mine : names.length ? names[0].key : "";
    }
    var pl = $("st-player");
    pl.textContent = "";
    pl.classList.add("scroll");
    names.forEach(function (n) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.v = n.key;
      b.textContent = n.name;
      b.setAttribute("aria-pressed", String(n.key === key));
      pl.appendChild(b);
    });
    pl.parentNode.hidden = names.length < 2;

    var now = Date.now();
    var from = days ? now - days * DAY : 0;
    var rows = entriesFor(hist, key, from, now + 1);
    $("st-body").hidden = !rows.length;
    $("st-empty").hidden = !!rows.length;
    renderTrainingStats(key || keyOf(myName()), from);
    if (!rows.length) return;

    var a = aggregate(rows);
    $("st-avg").textContent = fmt1(a.avg);
    var delta = $("st-delta");
    delta.textContent = "";
    if (days && a.avg !== null) {
      var prev = aggregate(entriesFor(hist, key, from - days * DAY, from));
      if (prev.avg !== null) {
        var d = a.avg - prev.avg;
        var b = document.createElement("b");
        b.textContent = (d >= 0 ? "▲ " : "▼ ") + fmt1(Math.abs(d));
        delta.append(b, document.createTextNode(" t.o.v. de " + (days === 7 ? "week" : "periode") + " daarvoor (" + fmt1(prev.avg) + ")"));
      }
    }
    var lvl = null;
    L.BOT_LEVELS.forEach(function (l) { if (a.avg !== null && a.avg >= l.avg - 5) lvl = l; });
    $("st-level").textContent = a.avg === null ? "" : lvl ? "Dat is ongeveer " + lvl.name + "-niveau. Probeer de bot op " + Math.round(a.avg + 5) + " eens." : "Begin tegen de Starter-bot.";

    var tiles = [
      ["First 9", fmt1(a.f9), "gemiddelde eerste 9 darts"],
      ["Uitgooi %", a.co === null ? "–" : Math.round(a.co) + "%", a.dblHits + " van " + a.dblDarts + " op de dubbel"],
      ["Gewonnen", a.wins + "/" + a.matches, Math.round((a.wins / a.matches) * 100) + "% van je wedstrijden"],
      ["Legs", a.legsWon + "/" + a.legsPlayed, a.legsPlayed ? Math.round((a.legsWon / a.legsPlayed) * 100) + "% gewonnen" : ""],
      ["Hoogste uitgooi", a.highOut || "–", ""],
      ["Snelste leg", a.bestLeg ? a.bestLeg : "–", a.bestLeg ? "darts" : ""],
      ["180's", a.s180, ""],
      ["140+ / 100+", a.s140 + " / " + a.s100, ""],
    ];
    var box = $("st-tiles");
    box.textContent = "";
    tiles.forEach(function (t) {
      var el = document.createElement("div");
      el.className = "tile";
      var lab = document.createElement("span");
      lab.className = "label";
      lab.textContent = t[0];
      var val = document.createElement("b");
      val.textContent = t[1];
      el.append(lab, val);
      if (t[2]) {
        var sm = document.createElement("small");
        sm.textContent = t[2];
        el.appendChild(sm);
      }
      box.appendChild(el);
    });

    renderDoubles(rows);

    var chrono = rows.slice().reverse().filter(function (r) { return r.me.avg > 0; });
    drawChart(chrono);

    var list = $("history");
    list.textContent = "";
    rows.forEach(function (r) {
      var h = r.h, me = r.me;
      var won = me.won !== undefined ? me.won : h.players[h.winner] === me;
      var item = document.createElement("div");
      item.className = "panel item";
      var badge = document.createElement("span");
      badge.className = "badge" + (won ? " win" : "");
      badge.textContent = won ? "Winst" : "Verlies";
      var title = document.createElement("b");
      title.textContent = h.players.map(function (p) { return p.bot ? "Bot (" + p.bot + ")" : p.name; }).join(" – ");
      var score = document.createElement("span");
      score.className = "num";
      score.textContent = h.players.map(function (p) { return h.sets > 1 ? p.sets : p.legs; }).join(" – ") + (h.sets > 1 ? " sets" : " legs");
      var det = document.createElement("span");
      det.className = "muted num";
      var co = me.dblDarts ? " · uit " + Math.round((me.dblHits / me.dblDarts) * 100) + "%" : "";
      var f9 = me.f9Darts ? " · F9 " + fmt1((me.f9Points / me.f9Darts) * 3) : "";
      det.textContent = "Gem. " + fmt1(me.avg) + f9 + co;
      var when = document.createElement("span");
      when.className = "muted";
      when.textContent = new Date(h.date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " · " + h.start;
      item.append(badge, title, score, det, when);
      list.appendChild(item);
    });
  }

  function renderDoubles(rows) {
    var all = {};
    rows.forEach(function (r) {
      var d = r.me.doubles || {};
      Object.keys(d).forEach(function (k) {
        var x = all[k] || (all[k] = { att: 0, hit: 0 });
        x.att += d[k].att;
        x.hit += d[k].hit;
      });
    });
    var keys = Object.keys(all).filter(function (k) { return all[k].att > 0; });
    $("st-doubles-panel").hidden = !keys.length;
    if (!keys.length) return;
    keys.sort(function (a, b) { return all[b].hit - all[a].hit || all[b].att - all[a].att; });
    var fav = keys[0];
    var worst = keys.filter(function (k) { return all[k].att >= 3; })
      .sort(function (a, b) { return all[a].hit / all[a].att - all[b].hit / all[b].att; })[0];
    var favText = all[fav].hit ? "Favoriete dubbel: " + fav + " (" + all[fav].hit + " keer uitgegooid)." : "";
    if (worst && worst !== fav && all[worst].hit / all[worst].att < 0.25) {
      favText += " Oefenen: " + worst + " (" + all[worst].hit + " van " + all[worst].att + ").";
    }
    $("st-fav").textContent = favText.trim();
    var list = $("st-doubles");
    list.textContent = "";
    keys.slice(0, 10).forEach(function (k) {
      var x = all[k];
      var p = Math.round((x.hit / x.att) * 100);
      var row = document.createElement("div");
      row.className = "dbl-row";
      var name = document.createElement("b");
      name.textContent = k;
      var bar = document.createElement("div");
      bar.className = "bar";
      bar.setAttribute("aria-hidden", "true");
      var fill = document.createElement("i");
      fill.style.width = p + "%";
      bar.appendChild(fill);
      var txt = document.createElement("span");
      txt.textContent = x.hit + "/" + x.att + " · " + p + "%";
      row.append(name, bar, txt);
      list.appendChild(row);
    });
  }

  function renderTrainingStats(key, from) {
    var list = store.get("training", []).filter(function (e) { return e.date >= from && keyOf(e.name) === key; });
    $("st-training").hidden = !list.length;
    var box = $("st-train-tiles");
    box.textContent = "";
    if (!list.length) return;
    var tiles = [];
    var t121 = list.filter(function (e) { return e.type === "121"; });
    if (t121.length) {
      var best = Math.max.apply(null, t121.map(function (e) { return e.best || 0; }));
      tiles.push(["121 record", best || "–", t121.length + (t121.length === 1 ? " sessie" : " sessies")]);
    }
    var co = list.filter(function (e) { return e.type === "checkout"; });
    if (co.length) {
      var ok = co.reduce(function (a, e) { return a + e.ok; }, 0);
      var rounds = co.reduce(function (a, e) { return a + e.rounds; }, 0);
      tiles.push(["Uitgooi-training", Math.round((ok / Math.max(1, rounds)) * 100) + "%", ok + " van " + rounds + " finishes"]);
    }
    ["any", "double", "treble"].forEach(function (mode) {
      var a = list.filter(function (e) { return e.type === "atc" && e.mode === mode && e.done; });
      if (!a.length) return;
      var bestDarts = Math.min.apply(null, a.map(function (e) { return e.darts; }));
      tiles.push(["Around the Clock" + (mode === "double" ? " (D)" : mode === "treble" ? " (T)" : ""), bestDarts, "darts, beste rondje"]);
    });
    tiles.forEach(function (t) {
      var el = document.createElement("div");
      el.className = "tile";
      var lab = document.createElement("span");
      lab.className = "label";
      lab.textContent = t[0];
      var val = document.createElement("b");
      val.textContent = t[1];
      var sm = document.createElement("small");
      sm.textContent = t[2];
      el.append(lab, val, sm);
      box.appendChild(el);
    });
  }

  // Reset
  var resetWhat = null;
  $("reset-stats").addEventListener("click", function () {
    resetWhat = "stats";
    $("reset-text").textContent = "Alle uitslagen, statistieken en trainingen wissen? Dit kun je niet terugdraaien.";
    $("reset-ask").hidden = false;
  });
  $("reset-all").addEventListener("click", function () {
    resetWhat = "all";
    $("reset-text").textContent = "Alles wissen: statistieken, trainingen, instellingen, camera-kalibratie en een lopende wedstrijd? Dit kun je niet terugdraaien.";
    $("reset-ask").hidden = false;
  });
  $("reset-no").addEventListener("click", function () { $("reset-ask").hidden = true; });
  $("reset-yes").addEventListener("click", function () {
    store.del("history");
    store.del("training");
    if (resetWhat === "all") {
      ["settings", "calib", "match", "lastSetup", "atc"].forEach(store.del);
      location.reload();
      return;
    }
    $("reset-ask").hidden = true;
    toast("Statistieken gewist");
    renderHistory();
  });

  function drawChart(rows) {
    var box = $("st-chart");
    box.textContent = "";
    if (rows.length < 2) {
      var p = document.createElement("p");
      p.className = "chart-empty";
      p.textContent = "Speel minstens 2 wedstrijden om hier je lijn te zien.";
      box.appendChild(p);
      return;
    }
    var W = Math.max(280, box.clientWidth || 600), H = 220;
    var pad = { l: 34, r: 14, t: 14, b: 26 };
    var vals = rows.map(function (r) { return r.me.avg; });
    var lo = Math.floor((Math.min.apply(null, vals) - 2) / 10) * 10;
    var hi = Math.ceil((Math.max.apply(null, vals) + 2) / 10) * 10;
    if (hi - lo < 20) hi = lo + 20;
    var step = hi - lo > 60 ? 20 : 10;
    var x = function (i) { return pad.l + (i / (rows.length - 1)) * (W - pad.l - pad.r); };
    var y = function (v) { return pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b); };
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Gemiddelde per wedstrijd, van " + fmt1(vals[0]) + " naar " + fmt1(vals[vals.length - 1]));
    for (var g = lo; g <= hi; g += step) {
      el("line", { x1: pad.l, x2: W - pad.r, y1: y(g), y2: y(g), stroke: "var(--line)", "stroke-width": 1 }, svg);
      var t = el("text", { x: pad.l - 6, y: y(g) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }, svg);
      t.textContent = g;
    }
    var dateLabel = function (r) { return new Date(r.h.date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }); };
    var t0 = el("text", { x: pad.l, y: H - 6, "font-size": 11, fill: "var(--muted)" }, svg);
    t0.textContent = dateLabel(rows[0]);
    var t1 = el("text", { x: W - pad.r, y: H - 6, "font-size": 11, fill: "var(--muted)", "text-anchor": "end" }, svg);
    t1.textContent = dateLabel(rows[rows.length - 1]);
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
    el("path", { d: d, fill: "none", stroke: "var(--accent)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    var cross = el("line", { y1: pad.t, y2: H - pad.b, stroke: "var(--muted)", "stroke-width": 1, visibility: "hidden" }, svg);
    var dot = el("circle", { r: 5, fill: "var(--accent)", stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }, svg);
    var last = rows.length - 1;
    el("circle", { cx: x(last), cy: y(vals[last]), r: 5, fill: "var(--accent)", stroke: "var(--surface)", "stroke-width": 2 }, svg);
    var endLabel = el("text", { x: x(last) - 8, y: y(vals[last]) - 10, "text-anchor": "end", "font-size": 12, "font-weight": 600, fill: "var(--fg)" }, svg);
    endLabel.textContent = fmt1(vals[last]);
    box.appendChild(svg);
    var tip = document.createElement("div");
    tip.className = "tip";
    tip.hidden = true;
    box.appendChild(tip);

    function hover(evt) {
      var rect = svg.getBoundingClientRect();
      var px = ((evt.clientX - rect.left) / rect.width) * W;
      var i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (rows.length - 1));
      i = Math.max(0, Math.min(rows.length - 1, i));
      var r = rows[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(vals[i])); dot.setAttribute("visibility", "visible");
      var opp = r.h.players.filter(function (p) { return p !== r.me; }).map(function (p) { return p.bot ? "bot " + p.bot : p.name; }).join(", ");
      tip.textContent = "";
      var big = document.createElement("b");
      big.textContent = fmt1(vals[i]);
      tip.append(big, document.createTextNode(dateLabel(r) + (opp ? " · tegen " + opp : "")));
      tip.hidden = false;
      var left = (x(i) / W) * rect.width;
      tip.style.left = Math.max(70, Math.min(rect.width - 70, left)) + "px";
    }
    svg.addEventListener("pointermove", hover);
    svg.addEventListener("pointerdown", hover);
    svg.addEventListener("pointerleave", function () {
      cross.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
      tip.hidden = true;
    });
  }

  window.addEventListener("resize", function () { if (!$("screen-history").hidden) renderHistory(); });

  // ── Camera ─────────────────────────────────────────────────────────────
  var FRAME_W = 640;
  var video = $("cam-video");
  var overlay = $("cam-overlay");
  var stream = null;
  var detector = null;
  var calibrating = null; // lijst met getikte punten tijdens kalibratie
  var calib = store.get("calib", null);
  var awaitingPull = false;

  function setCamStatus(state, text) {
    $("cam-status").dataset.state = state;
    $("cam-status-text").textContent = text;
  }

  $("cam-sens").value = settings.camSens;
  $("cam-sens").addEventListener("input", function () {
    settings.camSens = Number(this.value);
    saveSettings();
    if (detector) detector.sensitivity = settings.camSens;
  });

  $("cam-select").addEventListener("change", function () {
    settings.camId = this.value;
    saveSettings();
    if (stream) startCamera();
  });

  async function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    var devices = await navigator.mediaDevices.enumerateDevices();
    var sel = $("cam-select");
    sel.textContent = "";
    var def = document.createElement("option");
    def.value = "";
    def.textContent = "Standaard (achtercamera)";
    sel.appendChild(def);
    devices.filter(function (d) { return d.kind === "videoinput"; }).forEach(function (d, i) {
      var o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || "Camera " + (i + 1);
      sel.appendChild(o);
    });
    sel.value = settings.camId;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamStatus("error", "Deze browser geeft geen toegang tot de camera. Open de app via de link in de handleiding.");
      return;
    }
    stopCamera();
    try {
      var constraints = settings.camId
        ? { deviceId: { exact: settings.camId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } };
      stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
    } catch (e) {
      setCamStatus("error", e && e.name === "NotAllowedError"
        ? "Geen toegang tot de camera. Sta de camera toe in je browser, of start de app op je pc met start-dartapp."
        : "Camera niet gevonden of al in gebruik door een ander programma.");
      return;
    }
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* speelt bij de volgende tik */ }
    await new Promise(function (res) {
      if (video.videoWidth) res();
      else video.addEventListener("loadedmetadata", res, { once: true });
    });
    $("cam-empty").hidden = true;
    $("cam-calib").disabled = false;
    keepScreenOn();
    $("cam-start").textContent = "Camera uit";
    listCameras();
    sizeOverlay();
    if (calib) startDetector();
    else {
      setCamStatus("off", "Camera aan. Kalibreer nu het bord.");
      beginCalibration();
    }
  }

  // Houd het scherm aan zolang de camera meekijkt (telefoon naast het bord).
  var wakeLock = null;
  async function keepScreenOn() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", function () { wakeLock = null; });
      }
    } catch (e) { /* niet ondersteund of geweigerd */ }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && stream) keepScreenOn();
  });

  function stopCamera() {
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    if (detector) { detector.stop(); detector = null; }
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    video.srcObject = null;
    $("cam-empty").hidden = false;
    $("cam-calib").disabled = true;
    $("cam-pulled").hidden = true;
    $("cam-start").textContent = "Camera aan";
    calibrating = null;
    $("calib-hint").hidden = true;
    setCamStatus("off", "Camera staat uit");
    drawOverlay();
  }

  $("cam-start").addEventListener("click", function () {
    if (stream) stopCamera();
    else startCamera();
  });

  function startDetector() {
    if (detector) detector.stop();
    detector = new V.Detector({
      video: video,
      H: calib.H,
      frameWidth: FRAME_W,
      sensitivity: settings.camSens,
      onDart: function (hit) {
        if (awaitingPull) return;
        if (!canInput()) return;
        setCamStatus("ready", "Gezien: " + hit.label);
        humanDart(hit);
        drawOverlay();
      },
      onBigChange: function () {
        if (awaitingPull) {
          awaitingPull = false;
          $("cam-pulled").hidden = true;
          setCamStatus("ready", "Klaar voor de volgende beurt");
        }
      },
      onStatus: function (state, text) {
        if (awaitingPull && state !== "error") return;
        if (state === "moving" && /^Gezien/.test($("cam-status-text").textContent)) return;
        setCamStatus(state, text);
      },
    });
    if (!detector.start()) detector = null;
  }

  function cameraTurnEnded() {
    if (!detector) return;
    awaitingPull = true;
    $("cam-pulled").hidden = false;
    setCamStatus("pull", "Haal je darts uit het bord");
  }

  $("cam-pulled").addEventListener("click", function () {
    awaitingPull = false;
    $("cam-pulled").hidden = true;
    if (detector) detector.resetReference();
    setCamStatus("ready", "Klaar voor de volgende beurt");
  });

  // Kalibratie
  function beginCalibration() {
    if (!stream) return;
    if (detector) { detector.stop(); detector = null; }
    calibrating = [];
    calibHint();
    drawOverlay();
  }
  $("cam-calib").addEventListener("click", beginCalibration);

  function calibHint() {
    var hint = $("calib-hint");
    if (!calibrating) { hint.hidden = true; return; }
    var p = V.CALIB_POINTS[calibrating.length];
    hint.hidden = false;
    hint.textContent = "Punt " + (calibrating.length + 1) + " van 4: tik op de buitenrand van de dubbelring, op de draad " + p.label + ".";
  }

  function videoRect() {
    // Waar het videobeeld binnen het vak staat (object-fit: contain).
    var box = overlay.getBoundingClientRect();
    var vw = video.videoWidth || 4, vh = video.videoHeight || 3;
    var scale = Math.min(box.width / vw, box.height / vh);
    return { x: (box.width - vw * scale) / 2, y: (box.height - vh * scale) / 2, scale: scale, vw: vw, vh: vh, box: box };
  }

  function frameToDisplay(p, r) {
    var k = r.vw / FRAME_W;
    return { x: r.x + p.x * k * r.scale, y: r.y + p.y * k * r.scale };
  }

  function displayToFrame(x, y, r) {
    var k = r.vw / FRAME_W;
    return { x: (x - r.x) / r.scale / k, y: (y - r.y) / r.scale / k };
  }

  overlay.addEventListener("pointerdown", function (e) {
    if (!calibrating) return;
    var r = videoRect();
    var p = displayToFrame(e.clientX - r.box.left, e.clientY - r.box.top, r);
    calibrating.push(p);
    if (calibrating.length === 4) {
      var H = V.homography(V.CALIB_POINTS, calibrating);
      calibrating = null;
      calibHint();
      if (!H) {
        setCamStatus("error", "Kalibratie mislukt: de punten liggen te dicht bij elkaar. Probeer opnieuw.");
        return;
      }
      calib = { H: H, w: video.videoWidth, h: video.videoHeight };
      store.set("calib", calib);
      startDetector();
      toast("Kalibratie opgeslagen");
    } else {
      calibHint();
    }
    drawOverlay();
  });

  function sizeOverlay() {
    var box = overlay.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    overlay.width = Math.max(1, Math.round(box.width * dpr));
    overlay.height = Math.max(1, Math.round(box.height * dpr));
  }

  function drawOverlay() {
    if ($("mode-camera").hidden) return;
    sizeOverlay();
    var ctx = overlay.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!stream) return;
    var r = videoRect();
    var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f2c14e";

    if (calibrating) {
      ctx.fillStyle = accent;
      ctx.strokeStyle = "#000";
      calibrating.forEach(function (p, i) {
        var d = frameToDisplay(p, r);
        ctx.beginPath();
        ctx.arc(d.x, d.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#000";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), d.x, d.y + 3.5);
        ctx.fillStyle = accent;
      });
      return;
    }
    if (!calib) return;
    var H = calib.H;
    var proj = function (x, y) { return frameToDisplay(V.apply(H, x, y), r); };
    ctx.strokeStyle = "rgba(242,193,78,0.85)";
    ctx.lineWidth = 1.2;
    [L.R.doubleOut, L.R.doubleIn, L.R.trebleOut, L.R.trebleIn, L.R.outerBull, L.R.bull].forEach(function (rad) {
      ctx.beginPath();
      for (var a = 0; a <= 360; a += 5) {
        var xy = L.polarToXY(rad, a);
        var p = proj(xy.x, xy.y);
        if (a === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    });
    for (var i = 0; i < 20; i++) {
      var a0 = L.polarToXY(L.R.outerBull, i * 18 + 9);
      var a1 = L.polarToXY(L.R.doubleOut, i * 18 + 9);
      var p0 = proj(a0.x, a0.y), p1 = proj(a1.x, a1.y);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    var darts = match && match.leg.turn.darts.length ? match.leg.turn.darts : recentDarts;
    darts.forEach(function (d) {
      if (d.x === undefined) return;
      var p = proj(d.x, d.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.stroke();
    });
  }

  window.addEventListener("resize", drawOverlay);

  // ── Start ──────────────────────────────────────────────────────────────
  // Als app op het beginscherm: offline werken via de service worker.
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(function () { /* niet beschikbaar */ });
  }
  buildBoard();
  syncVoice();
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
  show(match ? "play" : atc && !atc.done ? "atc" : "setup");
  maybeBot();
})();
