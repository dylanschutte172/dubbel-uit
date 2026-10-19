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
  var SCREENS = ["setup", "play", "result", "history"];

  function show(name) {
    SCREENS.forEach(function (s) { $("screen-" + s).hidden = s !== name; });
    document.querySelectorAll("[data-screen]").forEach(function (b) {
      var current = b.dataset.screen === name || (name === "result" && b.dataset.screen === "play");
      if (current) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (name === "setup") renderSetup();
    if (name === "play") render();
    if (name === "history") renderHistory();
  }

  document.querySelectorAll("[data-screen]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.screen === "play" && !match) { show(lastResult ? "result" : "setup"); return; }
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
    $("bot-options").hidden = settings.mode !== "bot";
    $("player-options").hidden = settings.mode !== "players";
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
    match = null;
    undoStack = [];
    recentDarts = [];
    persist();
    show("setup");
  });

  $("start-btn").addEventListener("click", function () { startMatch(buildConfig()); });
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
    if (total === rem && rem > 0) {
      var minDarts = match.cfg.doubleOut ? (L.checkout(rem, 1) ? 1 : L.checkout(rem, 2) ? 2 : L.checkout(rem, 3) ? 3 : 0) : Math.ceil(rem / 60);
      if (!minDarts) {
        toast(rem + " kun je niet uitgooien");
        return;
      }
      var box = $("finish-darts");
      box.textContent = "";
      for (var n = minDarts; n <= 3; n++) {
        (function (n) {
          var b = document.createElement("button");
          b.type = "button";
          b.innerHTML = "<b>" + n + "</b>" + (n === 1 ? "dart" : "darts");
          b.addEventListener("click", function () {
            $("finish-ask").hidden = true;
            pushUndo();
            kpValue = "";
            renderKeypad();
            afterEvent(L.addTurnTotal(match, total, n));
          });
          box.appendChild(b);
        })(n);
      }
      $("finish-ask").hidden = false;
      box.querySelector("button").focus();
      return;
    }
    pushUndo();
    kpValue = "";
    renderKeypad();
    recentDarts = [];
    afterEvent(L.addTurnTotal(match, total));
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
      date: match.endedAt || Date.now(),
      start: match.cfg.start,
      legs: match.cfg.legs,
      sets: match.cfg.sets,
      winner: match.winner,
      players: match.players.map(function (p) {
        return {
          name: p.name,
          bot: p.bot ? p.bot.avg : null,
          avg: Math.round(L.threeDartAverage(p.stats) * 10) / 10,
          sets: p.stats.setsWon,
          legs: p.stats.legsWon,
          s180: p.stats.s180,
          highOut: p.stats.highOut,
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

  function renderResult() {
    var m = lastResult;
    var w = m.players[m.winner];
    $("result-title").textContent = w.bot ? "De bot wint" : w.name + " wint!";
    var t = $("result-table");
    var rows = [
      ["", function (p) { return p.name; }],
      [m.cfg.sets > 1 ? "Sets" : "Legs", function (p) { return m.cfg.sets > 1 ? p.stats.setsWon : p.stats.legsWon; }],
      ["Gemiddelde", function (p) { return L.threeDartAverage(p.stats).toFixed(1); }],
      ["Darts", function (p) { return p.stats.darts; }],
      ["180", function (p) { return p.stats.s180; }],
      ["140+", function (p) { return p.stats.s140; }],
      ["100+", function (p) { return p.stats.s100; }],
      ["Beste beurt", function (p) { return p.stats.best; }],
      ["Hoogste uitgooi", function (p) { return p.stats.highOut || "–"; }],
    ];
    t.textContent = "";
    var thead = document.createElement("thead");
    var trh = document.createElement("tr");
    rows.forEach(function (r) {
      var th = document.createElement("th");
      th.textContent = r[0];
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    t.appendChild(thead);
    var tbody = document.createElement("tbody");
    m.players.forEach(function (p) {
      var tr = document.createElement("tr");
      rows.forEach(function (r) {
        var td = document.createElement("td");
        td.textContent = r[1](p);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
  }

  $("rematch-btn").addEventListener("click", function () {
    if (!lastSetup) { show("setup"); return; }
    var cfg = JSON.parse(JSON.stringify(lastSetup));
    cfg.first = (cfg.first + 1) % cfg.players.length;
    startMatch(cfg);
  });
  $("new-btn").addEventListener("click", function () { show("setup"); });

  function renderHistory() {
    var box = $("history");
    box.textContent = "";
    var hist = store.get("history", []);
    if (!hist.length) {
      var p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Nog geen wedstrijden gespeeld. Je uitslagen verschijnen hier.";
      box.appendChild(p);
      return;
    }
    hist.forEach(function (h) {
      var item = document.createElement("div");
      item.className = "panel item";
      var title = document.createElement("b");
      title.textContent = h.players.map(function (p) { return p.name + (p.bot ? " (" + p.bot + ")" : ""); }).join(" – ");
      var score = document.createElement("span");
      score.className = "num";
      score.textContent = h.players.map(function (p) { return h.sets > 1 ? p.sets : p.legs; }).join(" – ") + (h.sets > 1 ? " sets" : " legs");
      var avg = document.createElement("span");
      avg.className = "muted num";
      avg.textContent = "Gem. " + h.players.map(function (p) { return p.avg.toFixed(1); }).join(" / ");
      var when = document.createElement("span");
      when.className = "muted";
      when.textContent = new Date(h.date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " · " + h.start;
      item.append(title, score, avg, when);
      box.appendChild(item);
    });
  }

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
  show(match ? "play" : "setup");
  maybeBot();
})();
