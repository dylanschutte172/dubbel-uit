// Draai met: node --test dartapp/tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const lbl = (p) => (p ? p.map((d) => d.label).join(" ") : null);

test("scoreAt raakt de juiste vakken", () => {
  assert.equal(L.scoreAt(0, 0).label, "Bull");
  assert.equal(L.scoreAt(0, 10).label, "25");
  assert.equal(L.scoreAt(0, 103).label, "T20");
  assert.equal(L.scoreAt(0, 166).label, "D20");
  assert.equal(L.scoreAt(0, 171).label, "Mis");
  assert.equal(L.scoreAt(103, 0).label, "T6");
  assert.equal(L.scoreAt(0, -166).label, "D3");
  assert.equal(L.scoreAt(-134, 0).label, "11");
  for (const n of L.ORDER) {
    const t = L.targetPoint(L.dart(3, n));
    assert.equal(L.scoreAt(t.x, t.y).label, "T" + n);
  }
});

test("bekende uitgooiroutes", () => {
  assert.equal(lbl(L.checkout(170)), "T20 T20 Bull");
  assert.equal(lbl(L.checkout(40)), "D20");
  assert.equal(lbl(L.checkout(32)), "D16");
  assert.equal(lbl(L.checkout(100)), "T20 D20");
  assert.equal(L.checkout(169), null);
  assert.equal(L.checkout(159), null);
  assert.equal(L.checkout(1), null);
  for (let r = 2; r <= 170; r++) {
    const p = L.checkout(r);
    if (!p) continue;
    assert.equal(p.reduce((s, d) => s + d.score, 0), r, "som " + r);
    assert.ok(p[p.length - 1].isDouble, "dubbel " + r);
  }
});

test("bot-niveau komt ongeveer uit op het gemiddelde", () => {
  for (const lvl of L.BOT_LEVELS) {
    const sigma = L.sigmaForAverage(lvl.avg);
    assert.ok(Math.abs(L.averageForSigma(sigma) - lvl.avg) < 1.5, lvl.name);
  }
  assert.ok(L.sigmaForAverage(30) > L.sigmaForAverage(90));
});

test("bust en dubbel-uit regels", () => {
  assert.deepEqual(L.applyDart(40, L.dart(2, 20), true), { rem: 0, bust: false, finished: true });
  assert.equal(L.applyDart(40, L.dart(1, 20), true).bust, false);
  assert.equal(L.applyDart(20, L.dart(1, 20), true).bust, true);
  assert.equal(L.applyDart(21, L.dart(1, 20), true).bust, true);
  assert.equal(L.applyDart(20, L.dart(1, 20), false).finished, true);
  assert.equal(L.isPossibleTurnTotal(179), false);
  assert.equal(L.isPossibleTurnTotal(180), true);
});

test("een leg spelen en winnen", () => {
  const m = L.createMatch({ start: 101, legs: 1, sets: 1, players: [{ name: "A" }, { name: "B" }] });
  assert.equal(L.addDart(m, L.dart(3, 20)), null);
  assert.equal(L.addDart(m, L.dart(1, 1)), null);
  assert.equal(L.addDart(m, L.dart(1, 20)).type, "turn"); // 101-81 = 20
  assert.equal(m.leg.current, 1);
  L.addTurnTotal(m, 26);
  assert.equal(m.leg.rem[0], 20);
  assert.equal(L.addDart(m, L.dart(1, 20)).type, "bust");
  assert.equal(m.leg.rem[0], 20);
  L.addTurnTotal(m, 0);
  const ev = L.addDart(m, L.dart(2, 10));
  assert.equal(ev.type, "match");
  assert.equal(m.winner, 0);
  assert.equal(m.players[0].stats.highOut, 20);
  assert.equal(m.players[0].stats.darts, 3 + 1 + 1);
});

test("legs en sets wisselen van beginner", () => {
  const m = L.createMatch({ start: 40, legs: 2, sets: 2, players: [{ name: "A" }, { name: "B" }] });
  L.addDart(m, L.dart(2, 20)); // A wint leg 1
  assert.equal(m.leg.current, 1);
  L.addDart(m, L.dart(2, 20)); // B wint leg 2
  assert.equal(m.leg.current, 0);
  const ev = L.addDart(m, L.dart(2, 20)); // A wint leg 3 → set
  assert.equal(ev.type, "set");
  assert.equal(m.setNo, 2);
  assert.equal(m.leg.current, 1);
});

test("bot gooit een leg uit", () => {
  const rand = L.rng(7);
  const m = L.createMatch({ start: 501, legs: 1, sets: 1, players: [{ name: "Bot", bot: { avg: 90 } }] });
  let guard = 0;
  while (m.winner === null && guard++ < 500) {
    const rem = L.currentRem(m);
    const left = 3 - m.leg.turn.darts.length;
    L.addDart(m, L.botThrow(L.botAim(rem, left, true), m.players[0].bot.sigma, rand));
  }
  assert.equal(m.winner, 0);
});

test("first 9, dubbels en snelste leg worden bijgehouden", () => {
  const m = L.createMatch({ start: 141, legs: 2, sets: 1, players: [{ name: "A" }, { name: "B" }] });
  // A: T20 T20 = 120 → 21 over; B gooit 0; A: S1 (op 21, geen dubbelkans), D10 mis (S10), D10 raak
  L.addDart(m, L.dart(3, 20)); L.addDart(m, L.dart(3, 20)); L.addDart(m, L.dart(1, 1)); // 141-121 = 20
  L.addTurnTotal(m, 0);
  L.addDart(m, L.dart(1, 10)); // op 20 (dubbelkans) → mis, 10 over
  L.addDart(m, L.dart(1, 5));  // op 10 (dubbelkans) → 5 over
  L.addDart(m, L.dart(0, 0));  // op 5: geen dubbelkans (oneven)
  L.addTurnTotal(m, 0);
  L.addDart(m, L.dart(1, 1));  // op 5: geen kans → 4
  const ev = L.addDart(m, L.dart(2, 2)); // op 4: raak
  assert.equal(ev.type, "leg");
  const s = m.players[0].stats;
  assert.equal(s.dblDarts, 3);
  assert.equal(s.dblHits, 1);
  assert.equal(Math.round(L.checkoutPercentage(s)), 33);
  assert.equal(s.f9Darts, 8); // 3 + 3 + 2 darts in de eerste drie beurten
  assert.equal(s.f9Points, 121 + 15 + 5);
  assert.equal(s.bestLeg, 8);
  assert.equal(s.legsPlayed, 1);
  assert.equal(m.players[1].stats.legsPlayed, 1);
  assert.equal(L.checkoutPercentage(m.players[1].stats), null);
});

test("cijferinvoer: darts op de dubbel worden meegegeven", () => {
  const m = L.createMatch({ start: 40, legs: 1, sets: 1, players: [{ name: "A" }] });
  L.addTurnTotal(m, 0, undefined, 3); // 3 keer mis op D20
  L.addTurnTotal(m, 40, 2, 2);        // in 2 darts uit, beide op de dubbel
  const s = m.players[0].stats;
  assert.equal(s.dblDarts, 5);
  assert.equal(s.dblHits, 1);
  assert.equal(L.isOneDartFinish(40), true);
  assert.equal(L.isOneDartFinish(41), false);
  assert.equal(L.isOneDartFinish(50), true);
});
