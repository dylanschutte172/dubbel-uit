/* Dubbel Uit — dartlogica zonder DOM: bord, scores, uitgooiroutes, bot, wedstrijd.
 * Werkt als gewoon <script> (window.DartLogic) en in Node (module.exports) voor tests.
 */
(function (root) {
  "use strict";

  // ── Bord ───────────────────────────────────────────────────────────────
  // Afmetingen in mm volgens de officiële regels. Coördinaten: x rechts, y omhoog.
  var R = {
    bull: 6.35,
    outerBull: 15.9,
    trebleIn: 99,
    trebleOut: 107,
    doubleIn: 162,
    doubleOut: 170,
  };
  // Klokwijs vanaf boven.
  var ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  function angleOf(num) {
    // Hoek (graden, klokwijs vanaf boven) van het midden van een segment.
    return ORDER.indexOf(num) * 18;
  }

  function polarToXY(radius, deg) {
    var a = (deg * Math.PI) / 180;
    return { x: radius * Math.sin(a), y: radius * Math.cos(a) };
  }

  function dart(mult, num) {
    // mult: 0 = mis, 1 = enkel, 2 = dubbel, 3 = triple. num 25 = bull.
    var score = mult * num;
    var label;
    if (mult === 0) label = "Mis";
    else if (num === 25) label = mult === 2 ? "Bull" : "25";
    else label = (mult === 3 ? "T" : mult === 2 ? "D" : "") + num;
    return { mult: mult, num: num, score: score, label: label, isDouble: mult === 2 };
  }

  function scoreAt(x, y) {
    var r = Math.hypot(x, y);
    if (r > R.doubleOut) return dart(0, 0);
    if (r <= R.bull) return dart(2, 25);
    if (r <= R.outerBull) return dart(1, 25);
    var deg = (Math.atan2(x, y) * 180) / Math.PI;
    var idx = Math.floor((((deg + 9) % 360) + 360) % 360 / 18);
    var num = ORDER[idx];
    if (r >= R.trebleIn && r <= R.trebleOut) return dart(3, num);
    if (r >= R.doubleIn) return dart(2, num);
    return dart(1, num);
  }

  function targetPoint(d) {
    // Het punt waar je op mikt voor een bepaalde worp.
    if (d.num === 25) return d.mult === 2 ? { x: 0, y: 0 } : polarToXY(11, 0);
    var radius = d.mult === 3 ? 103 : d.mult === 2 ? 166 : 134;
    return polarToXY(radius, angleOf(d.num));
  }

  // ── Uitgooiroutes ──────────────────────────────────────────────────────
  // Voorkeur voor de laatste dubbel: de bekende "mooie" dubbels eerst.
  var DOUBLE_PREF = [20, 16, 8, 18, 12, 10, 4, 2, 14, 6, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1];

  var SETUP = (function () {
    var list = [];
    var tOrder = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    var sOrder = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    sOrder.forEach(function (n) { list.push(dart(1, n)); });
    tOrder.forEach(function (n) { list.push(dart(3, n)); });
    list.push(dart(1, 25));
    list.push(dart(2, 25));
    DOUBLE_PREF.forEach(function (n) { list.push(dart(2, n)); });
    return list;
  })();

  var FINISH = (function () {
    var list = DOUBLE_PREF.map(function (n) { return dart(2, n); });
    list.push(dart(2, 25));
    return list;
  })();

  function finishRank(d) {
    return FINISH.findIndex(function (f) { return f.label === d.label; });
  }

  var checkoutCache = {};

  function checkout(rem, maxDarts) {
    // Beste route om `rem` uit te gooien op een dubbel in maximaal `maxDarts` darts.
    maxDarts = maxDarts || 3;
    var key = rem + ":" + maxDarts;
    if (key in checkoutCache) return checkoutCache[key];
    var best = null;
    var bestCost = Infinity;

    function consider(path) {
      // Minder darts eerst, dan een betere laatste dubbel, dan enkels boven triples.
      var last = path[path.length - 1];
      var triples = path.filter(function (d) { return d.mult === 3; }).length;
      var cost = path.length * 1000 + finishRank(last) * 10 + triples;
      if (cost < bestCost) {
        bestCost = cost;
        best = path;
      }
    }

    if (rem >= 2 && rem <= 170) {
      FINISH.forEach(function (f) { if (f.score === rem) consider([f]); });
      if (maxDarts >= 2 && !best) {
        SETUP.forEach(function (a) {
          FINISH.forEach(function (f) { if (a.score + f.score === rem) consider([a, f]); });
        });
      }
      if (maxDarts >= 3 && !best) {
        SETUP.forEach(function (a) {
          SETUP.forEach(function (b) {
            var left = rem - a.score - b.score;
            if (left < 2) return;
            FINISH.forEach(function (f) { if (f.score === left) consider([a, b, f]); });
          });
        });
      }
    }
    checkoutCache[key] = best;
    return best;
  }

  // ── Bot ────────────────────────────────────────────────────────────────
  // Deterministische random (mulberry32), zodat kalibratie stabiel is.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussPair(rand) {
    var u = Math.max(rand(), 1e-12);
    var v = rand();
    var m = Math.sqrt(-2 * Math.log(u));
    return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)];
  }

  var CAL_SAMPLES = (function () {
    var rand = rng(180);
    var out = [];
    for (var i = 0; i < 6000; i++) out.push(gaussPair(rand));
    return out;
  })();

  function averageForSigma(sigma) {
    // Verwacht 3-darts gemiddelde als je steeds op T20 mikt.
    var t = targetPoint(dart(3, 20));
    var sum = 0;
    for (var i = 0; i < CAL_SAMPLES.length; i++) {
      var g = CAL_SAMPLES[i];
      sum += scoreAt(t.x + g[0] * sigma, t.y + g[1] * sigma).score;
    }
    return (sum / CAL_SAMPLES.length) * 3;
  }

  var sigmaCache = {};

  function sigmaForAverage(avg) {
    // Hoe verder de darts verspreid zijn (sigma, in mm), hoe lager het gemiddelde.
    avg = Math.max(15, Math.min(140, avg));
    var key = Math.round(avg * 10);
    if (key in sigmaCache) return sigmaCache[key];
    var lo = 0.5;
    var hi = 200;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (averageForSigma(mid) > avg) lo = mid;
      else hi = mid;
    }
    sigmaCache[key] = (lo + hi) / 2;
    return sigmaCache[key];
  }

  var BOT_LEVELS = [
    { id: "starter", name: "Starter", avg: 30 },
    { id: "kroeg", name: "Kroeg", avg: 45 },
    { id: "club", name: "Club", avg: 60 },
    { id: "competitie", name: "Competitie", avg: 75 },
    { id: "pro", name: "Pro", avg: 90 },
    { id: "wereldtop", name: "Wereldtop", avg: 105 },
  ];

  function botAim(rem, dartsLeft, doubleOut) {
    // Waar mikt de bot op? Uitgooien als het kan, anders voorbereiden of scoren.
    if (!doubleOut) {
      if (rem <= 60) {
        if (rem === 50) return dart(2, 25);
        if (rem === 25) return dart(1, 25);
        if (rem <= 20) return dart(1, rem);
        if (rem <= 40 && rem % 2 === 0) return dart(2, rem / 2);
        if (rem % 3 === 0 && rem / 3 <= 20) return dart(3, rem / 3);
        return dart(1, Math.min(20, rem - 20 > 0 ? 20 : rem));
      }
      return dart(3, 20);
    }
    var path = checkout(rem, dartsLeft) || checkout(rem, 3);
    if (path) return path[0];
    if (rem - 60 >= 2) return dart(3, 20);
    return dart(3, 19);
  }

  function botThrow(aim, sigma, rand) {
    rand = rand || Math.random;
    var t = targetPoint(aim);
    var g = gaussPair(rand);
    var x = t.x + g[0] * sigma;
    var y = t.y + g[1] * sigma;
    var hit = scoreAt(x, y);
    hit.x = x;
    hit.y = y;
    return hit;
  }

  // ── Regels ─────────────────────────────────────────────────────────────
  var IMPOSSIBLE = [163, 166, 169, 172, 173, 175, 176, 178, 179];

  function isPossibleTurnTotal(total) {
    return Number.isInteger(total) && total >= 0 && total <= 180 && IMPOSSIBLE.indexOf(total) === -1;
  }

  function applyDart(rem, d, doubleOut) {
    // Resultaat van één dart: { rem, bust, finished }.
    var next = rem - d.score;
    if (next < 0) return { rem: rem, bust: true, finished: false };
    if (doubleOut) {
      if (next === 1) return { rem: rem, bust: true, finished: false };
      if (next === 0 && !d.isDouble) return { rem: rem, bust: true, finished: false };
    }
    return { rem: next, bust: false, finished: next === 0 };
  }

  // ── Wedstrijd ──────────────────────────────────────────────────────────
  function newStats() {
    return {
      points: 0, darts: 0, s180: 0, s140: 0, s100: 0, highOut: 0, legsWon: 0, setsWon: 0, best: 0,
      f9Points: 0, f9Darts: 0, // eerste 9 darts (3 beurten) van elke leg
      dblDarts: 0, dblHits: 0, // darts op een uitgooi-dubbel en hoeveel daarvan raak
      legsPlayed: 0, bestLeg: 0, // aantal darts in de snelst gewonnen leg
      s60: 0, // beurten van 60 tot en met 99
    };
  }

  function isOneDartFinish(rem) {
    // Kun je dit met één dart uitgooien? Dan telt elke dart hierop als "dart op de dubbel".
    return rem === 50 || (rem >= 2 && rem <= 40 && rem % 2 === 0);
  }

  function createMatch(cfg) {
    // cfg: { start, legs, sets, doubleOut, first, players: [{ name, bot: null | { avg } }] }
    var players = cfg.players.map(function (p) {
      var out = { name: p.name, bot: null, stats: newStats() };
      if (p.bot) out.bot = { avg: p.bot.avg, sigma: sigmaForAverage(p.bot.avg), level: p.bot.level || "" };
      return out;
    });
    var match = {
      cfg: { start: cfg.start, legs: cfg.legs, sets: cfg.sets, doubleOut: cfg.doubleOut !== false },
      players: players,
      setStarter: 0,
      legStarter: 0,
      legsInSet: players.map(function () { return 0; }),
      leg: null,
      legNo: 1,
      setNo: 1,
      winner: null,
      startedAt: Date.now(),
      log: [],
    };
    var first = cfg.first || 0;
    match.setStarter = first;
    startLeg(match, first);
    return match;
  }

  function startLeg(match, starter) {
    match.legStarter = starter;
    match.leg = {
      rem: match.players.map(function () { return match.cfg.start; }),
      current: starter,
      turn: { start: match.cfg.start, darts: [] },
      turns: [],
    };
  }

  function currentRem(match) {
    var leg = match.leg;
    var rem = leg.turn.start;
    for (var i = 0; i < leg.turn.darts.length; i++) rem -= leg.turn.darts[i].score;
    return rem;
  }

  function recordTurn(match, total, dartsUsed, bust, finished, darts, dblDarts) {
    var leg = match.leg;
    var p = match.players[leg.current];
    var scored = bust ? 0 : total;
    p.stats.points += scored;
    p.stats.darts += dartsUsed;
    if (!leg.dartsBy) leg.dartsBy = match.players.map(function () { return 0; });
    leg.dartsBy[leg.current] += dartsUsed;
    var turnNo = leg.turns.filter(function (t) { return t.player === leg.current; }).length;
    if (turnNo < 3) {
      p.stats.f9Points += scored;
      p.stats.f9Darts += dartsUsed;
    }
    p.stats.dblDarts += dblDarts || 0;
    if (finished && match.cfg.doubleOut) p.stats.dblHits++;
    if (!bust) {
      if (scored === 180) p.stats.s180++;
      else if (scored >= 140) p.stats.s140++;
      else if (scored >= 100) p.stats.s100++;
      else if (scored >= 60) p.stats.s60++;
      if (scored > p.stats.best) p.stats.best = scored;
    }
    leg.turns.push({ player: leg.current, total: scored, darts: darts, bust: bust, left: bust ? leg.turn.start : leg.turn.start - total });
    leg.rem[leg.current] = bust ? leg.turn.start : leg.turn.start - total;

    var event = { type: bust ? "bust" : finished ? "leg" : "turn", player: leg.current, score: scored };
    if (finished) {
      if (total > p.stats.highOut) p.stats.highOut = total;
      event = finishLeg(match, total);
    } else {
      leg.current = (leg.current + 1) % match.players.length;
      leg.turn = { start: leg.rem[leg.current], darts: [] };
    }
    return event;
  }

  function finishLeg(match, checkoutScore) {
    var w = match.leg.current;
    var p = match.players[w];
    p.stats.legsWon++;
    var legDarts = match.leg.dartsBy ? match.leg.dartsBy[w] : 0;
    if (legDarts && (!p.stats.bestLeg || legDarts < p.stats.bestLeg)) p.stats.bestLeg = legDarts;
    match.players.forEach(function (pl) { pl.stats.legsPlayed++; });
    match.legsInSet[w]++;
    var event = { type: "leg", player: w, score: checkoutScore };
    if (match.legsInSet[w] >= match.cfg.legs) {
      p.stats.setsWon++;
      event.type = "set";
      if (p.stats.setsWon >= match.cfg.sets) {
        match.winner = w;
        match.endedAt = Date.now();
        event.type = "match";
        return event;
      }
      match.legsInSet = match.players.map(function () { return 0; });
      match.setNo++;
      match.setStarter = (match.setStarter + 1) % match.players.length;
      match.legNo = 1;
      startLeg(match, match.setStarter);
      return event;
    }
    match.legNo++;
    startLeg(match, (match.legStarter + 1) % match.players.length);
    return event;
  }

  function addDart(match, d) {
    // Eén dart toevoegen aan de huidige beurt. Geeft een event terug zodra de beurt klaar is.
    if (match.winner !== null) return null;
    var leg = match.leg;
    var rem = currentRem(match);
    var res = applyDart(rem, d, match.cfg.doubleOut);
    var stored = { mult: d.mult, num: d.num, score: d.score, label: d.label, isDouble: d.isDouble };
    if (match.cfg.doubleOut && isOneDartFinish(rem)) stored.atDouble = true;
    if (d.x !== undefined) { stored.x = d.x; stored.y = d.y; }
    leg.turn.darts.push(stored);
    var darts = leg.turn.darts.slice();
    var total = leg.turn.start - (res.bust ? rem : res.rem);
    var dbl = darts.filter(function (x) { return x.atDouble; }).length;
    if (res.bust) return recordTurn(match, total, darts.length, true, false, darts, dbl);
    if (res.finished) return recordTurn(match, leg.turn.start, darts.length, false, true, darts, dbl);
    if (darts.length === 3) return recordTurn(match, total, 3, false, false, darts, dbl);
    return null;
  }

  function addTurnTotal(match, total, dartsToFinish, dblDarts) {
    // Hele beurt in één keer invoeren (zoals op een scorebord). dartsToFinish alleen bij uitgooien;
    // dblDarts = hoeveel darts op een uitgooi-dubbel gingen (vraagt de app als het ertoe doet).
    if (match.winner !== null) return null;
    var leg = match.leg;
    var rem = leg.turn.start;
    var next = rem - total;
    var bust = next < 0 || (match.cfg.doubleOut && next === 1);
    var finished = next === 0;
    var used = finished ? dartsToFinish || 3 : 3;
    if (dblDarts === undefined) dblDarts = finished && !bust && match.cfg.doubleOut ? 1 : 0;
    return recordTurn(match, total, used, bust, finished && !bust, [], dblDarts);
  }

  function threeDartAverage(stats) {
    return stats.darts ? (stats.points / stats.darts) * 3 : 0;
  }

  function firstNineAverage(stats) {
    return stats.f9Darts ? (stats.f9Points / stats.f9Darts) * 3 : 0;
  }

  function checkoutPercentage(stats) {
    // null als er (nog) geen darts op een dubbel zijn gegooid.
    return stats.dblDarts ? (stats.dblHits / stats.dblDarts) * 100 : null;
  }

  var api = {
    R: R,
    ORDER: ORDER,
    angleOf: angleOf,
    polarToXY: polarToXY,
    dart: dart,
    scoreAt: scoreAt,
    targetPoint: targetPoint,
    checkout: checkout,
    rng: rng,
    averageForSigma: averageForSigma,
    sigmaForAverage: sigmaForAverage,
    BOT_LEVELS: BOT_LEVELS,
    botAim: botAim,
    botThrow: botThrow,
    isPossibleTurnTotal: isPossibleTurnTotal,
    applyDart: applyDart,
    createMatch: createMatch,
    currentRem: currentRem,
    addDart: addDart,
    addTurnTotal: addTurnTotal,
    threeDartAverage: threeDartAverage,
    firstNineAverage: firstNineAverage,
    checkoutPercentage: checkoutPercentage,
    isOneDartFinish: isOneDartFinish,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DartLogic = api;
})(typeof window !== "undefined" ? window : this);
