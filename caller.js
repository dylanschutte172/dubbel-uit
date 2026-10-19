/* Dubbel Uit — de omroeper, in de stijl van een tv-darts-caller.
 * Spreekt via de spraak van het toestel (Engels of Nederlands) en kan een juichend
 * publiek laten horen bij een 180 en bij een gewonnen wedstrijd.
 */
(function (root) {
  "use strict";

  var canSpeak = "speechSynthesis" in root;
  var opts = { enabled: true, lang: "en", crowd: true };
  var voices = { en: null, nl: null };
  var audio = null;

  function configure(o) {
    Object.keys(o).forEach(function (k) { opts[k] = o[k]; });
  }

  // ── Stem kiezen: liefst een Britse mannenstem, zoals op tv ────────────
  var EN_PREF = /Daniel|Arthur|George|Ryan|Oliver|Thomas|Malcolm|UK English Male|Google UK English/i;
  var NL_PREF = /Xander|Maarten|Frank|Google Nederlands/i;

  function pickVoices() {
    if (!canSpeak) return;
    var list = speechSynthesis.getVoices();
    var gb = list.filter(function (v) { return /^en[-_]GB/i.test(v.lang); });
    var en = list.filter(function (v) { return /^en/i.test(v.lang); });
    voices.en = gb.filter(function (v) { return EN_PREF.test(v.name); })[0] || gb[0] ||
      en.filter(function (v) { return EN_PREF.test(v.name); })[0] || en[0] || null;
    var nl = list.filter(function (v) { return /^nl/i.test(v.lang); });
    voices.nl = nl.filter(function (v) { return NL_PREF.test(v.name); })[0] ||
      nl.filter(function (v) { return /^nl[-_]NL/i.test(v.lang); })[0] || nl[0] || null;
  }

  if (canSpeak) {
    pickVoices();
    if (speechSynthesis.addEventListener) speechSynthesis.addEventListener("voiceschanged", pickVoices);
  }

  // Telefoons laten pas geluid toe na een aanraking: ontgrendel spraak en geluid daarmee.
  function unlock() {
    try {
      if (canSpeak) {
        var u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
      }
      var AC = root.AudioContext || root.webkitAudioContext;
      if (AC && !audio) audio = new AC();
      if (audio && audio.state === "suspended") audio.resume();
    } catch (e) { /* geen geluid */ }
    document.removeEventListener("pointerdown", unlock, true);
  }
  if (typeof document !== "undefined") document.addEventListener("pointerdown", unlock, true);

  // ── Spreken ────────────────────────────────────────────────────────────
  // say("tekst", { text, rate, pitch }, ...): delen worden na elkaar uitgesproken.
  function say() {
    if (!opts.enabled || !canSpeak) return;
    var parts = Array.prototype.slice.call(arguments).filter(Boolean);
    try {
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      parts.forEach(function (p) {
        if (typeof p === "string") p = { text: p };
        var u = new SpeechSynthesisUtterance(p.text);
        u.lang = opts.lang === "en" ? "en-GB" : "nl-NL";
        var v = voices[opts.lang];
        if (v) u.voice = v;
        u.rate = p.rate || 0.95;
        u.pitch = p.pitch || 0.9; // iets lager: klinkt meer als een caller
        speechSynthesis.speak(u);
      });
    } catch (e) { /* geen spraak */ }
  }

  function en() { return opts.lang === "en"; }

  // Zeg de Nederlandse of de Engelse tekst, afhankelijk van de gekozen taal.
  function line(nl, english) { say(en() ? english : nl); }

  var ORD_EN = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
    "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
  var ORD_NL = ["", "eerste", "tweede", "derde", "vierde", "vijfde", "zesde", "zevende", "achtste", "negende", "tiende",
    "elfde", "twaalfde", "dertiende", "veertiende", "vijftiende", "zestiende", "zeventiende", "achttiende", "negentiende", "twintigste"];

  function scoreParts(score) {
    if (score === 180) {
      crowd(1);
      // Uitgerekt, zoals het hoort.
      return en()
        ? [{ text: "One hundred", rate: 0.8, pitch: 0.95 }, { text: "and eighty!", rate: 0.6, pitch: 1.3 }]
        : [{ text: "Honderd", rate: 0.8, pitch: 0.95 }, { text: "tachtig!", rate: 0.6, pitch: 1.3 }];
    }
    if (score === 0) return [{ text: en() ? "No score" : "Geen score", rate: 0.9 }];
    if (score >= 140) return [{ text: String(score) + "!", rate: 0.78, pitch: 1.15 }];
    if (score >= 100) return [{ text: String(score) + "!", rate: 0.85, pitch: 1.05 }];
    return [{ text: String(score), rate: 0.95 }];
  }

  function requires(name, rem) {
    if (!name || !rem) return null;
    return { text: en() ? name + ", you require " + rem : name + ", je hebt " + rem + " nodig", rate: 0.95 };
  }

  // Score van een beurt, plus wat de volgende speler nodig heeft (als die kan uitgooien).
  function score(points, nextName, nextRem) {
    say.apply(null, scoreParts(points).concat([requires(nextName, nextRem)]));
  }

  function bust(nextName, nextRem) {
    say({ text: en() ? "No score" : "Geen score", rate: 0.9 }, requires(nextName, nextRem));
  }

  // type: "leg", "set" of "match"
  function gameShot(type, name, legNo, setNo, solo) {
    if (type === "match") crowd(1.2);
    var first = { text: "Game shot!", rate: 0.85, pitch: 1.15 };
    var rest;
    if (en()) {
      if (type === "match") rest = "and the match, " + name + "!";
      else if (type === "set") rest = "and the " + (ORD_EN[setNo] || "") + " set, " + name + "!";
      else rest = solo ? "Well thrown!" : "and the " + (ORD_EN[legNo] || "") + " leg, " + name + "!";
    } else {
      if (type === "match") rest = "en de wedstrijd voor " + name + "!";
      else if (type === "set") rest = "en de " + (ORD_NL[setNo] || "") + " set voor " + name + "!";
      else rest = solo ? "Mooi gegooid!" : "en de " + (ORD_NL[legNo] || "") + " leg voor " + name + "!";
    }
    say(first, { text: rest, rate: 0.9 });
  }

  function gameOn(firstName, solo) {
    if (solo || !firstName) { say({ text: "Game on!", rate: 0.85, pitch: 1.1 }); return; }
    say({ text: en() ? firstName + " to throw first." : firstName + " begint.", rate: 0.95 },
      { text: "Game on!", rate: 0.85, pitch: 1.1 });
  }

  // ── Publiek: gesynthetiseerd gejuich (ruis die aanzwelt en wegsterft) ─
  function crowd(strength) {
    if (!opts.enabled || !opts.crowd || !audio) return;
    try {
      var dur = 2.6;
      var rate = audio.sampleRate;
      var buf = audio.createBuffer(2, Math.floor(rate * dur), rate);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch);
        var b0 = 0, b1 = 0, b2 = 0;
        for (var i = 0; i < d.length; i++) {
          // roze-achtige ruis met een beetje "rumoer"
          var w = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + w * 0.099;
          b1 = 0.963 * b1 + w * 0.2965;
          b2 = 0.57 * b2 + w * 1.0527;
          var t = i / rate;
          var wobble = 0.8 + 0.2 * Math.sin(t * 9 + ch) * Math.sin(t * 3.3);
          d[i] = (b0 + b1 + b2 + w * 0.18) * 0.12 * wobble;
        }
      }
      var src = audio.createBufferSource();
      src.buffer = buf;
      var band = audio.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1100;
      band.Q.value = 0.6;
      var gain = audio.createGain();
      var now = audio.currentTime;
      var peak = 0.55 * (strength || 1);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.35);
      gain.gain.setValueAtTime(peak, now + 1.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(band).connect(gain).connect(audio.destination);
      src.start(now);
    } catch (e) { /* geen geluid */ }
  }

  root.DartCaller = {
    configure: configure,
    say: say,
    line: line,
    score: score,
    bust: bust,
    gameShot: gameShot,
    gameOn: gameOn,
    crowd: crowd,
    isEnglish: en,
    canSpeak: canSpeak,
  };
})(typeof window !== "undefined" ? window : this);
