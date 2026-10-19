/* Dubbel Uit — camera: kalibratie (homografie) en automatische dartherkenning.
 *
 * Werkwijze:
 * 1. Je tikt 4 punten aan op de buitenrand van de dubbelring. Daaruit volgt een
 *    homografie: een omrekening van bordcoördinaten (mm) naar camerapixels.
 * 2. Elk camerabeeld wordt "rechtgetrokken" naar een bovenaanzicht van het bord.
 * 3. Staat het beeld stil, dan vergelijken we het met het vorige stilstaande beeld.
 *    Een klein nieuw vlekje = een nieuwe dart; een grote verandering = darts eruit.
 * 4. De punt van de dart is het deel van de vlek dat het dichtst bij de camera
 *    ligt (in bovenaanzicht): de rest van de dart steekt naar je toe en valt
 *    daardoor in beeld verder van de camera af.
 */
(function (root) {
  "use strict";

  var L = root.DartLogic || (typeof require !== "undefined" ? require("./logic.js") : null);

  // Kalibratiepunten: buitenrand van de dubbel op de draad tussen twee segmenten.
  var CALIB_POINTS = [
    { label: "tussen 20 en 1", deg: 9 },
    { label: "tussen 6 en 10", deg: 99 },
    { label: "tussen 3 en 19", deg: 189 },
    { label: "tussen 11 en 14", deg: 279 },
  ].map(function (p) {
    var xy = L.polarToXY(L.R.doubleOut, p.deg);
    return { label: p.label, x: xy.x, y: xy.y };
  });

  // ── Homografie ─────────────────────────────────────────────────────────
  function solve(A, b) {
    // Gauss-eliminatie met pivotering. A is n×n, b lengte n.
    var n = b.length;
    var M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = M[r2][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    return M.map(function (row, i) { return row[n] / row[i]; });
  }

  function homography(src, dst) {
    // 3×3 matrix (rij-voor-rij, 9 getallen) die src-punten op dst-punten afbeeldt.
    var A = [];
    var b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i].x, y = src[i].y, u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var h = solve(A, b);
    if (!h) return null;
    h.push(1);
    return h;
  }

  function apply(H, x, y) {
    var w = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
  }

  function invert(H) {
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7], i = H[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    var det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    return [
      A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
    ];
  }

  function cameraFoot(H, width, height) {
    // Schat waar de camera staat, geprojecteerd op het bordvlak (mm).
    // Neemt een gangbare brandpuntsafstand aan; de richting is wat telt.
    var f = 0.9 * Math.max(width, height);
    var cx = width / 2, cy = height / 2;
    function col(k) {
      var h0 = H[k], h1 = H[3 + k], h2 = H[6 + k];
      return [(h0 - cx * h2) / f, (h1 - cy * h2) / f, h2];
    }
    var r1 = col(0), r2 = col(1), t = col(2);
    var lambda = Math.hypot(r1[0], r1[1], r1[2]);
    if (t[2] / lambda < 0) lambda = -lambda; // bord ligt vóór de camera
    var dot = function (a, b) { return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (lambda * lambda); };
    var foot = { x: -dot(r1, t), y: -dot(r2, t) };
    if (!isFinite(foot.x) || !isFinite(foot.y)) return { x: 0, y: 0 };
    return foot;
  }

  // ── Detector ───────────────────────────────────────────────────────────
  var GRID = 220; // bovenaanzicht in GRID×GRID pixels
  var SPAN = 180; // mm vanaf het midden tot de rand van het bovenaanzicht
  var MM = (2 * SPAN) / GRID;

  function gridToBoard(i, j) {
    return { x: -SPAN + (i + 0.5) * MM, y: SPAN - (j + 0.5) * MM };
  }

  function Detector(opts) {
    this.video = opts.video;
    this.H = opts.H; // bord (mm) → camerapixels op opts.frameWidth breed
    this.frameWidth = opts.frameWidth;
    this.sensitivity = opts.sensitivity || 30;
    this.onDart = opts.onDart || function () {};
    this.onBigChange = opts.onBigChange || function () {};
    this.onStatus = opts.onStatus || function () {};
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.timer = null;
    this.ref = null;
    this.prev = null;
    this.stableTicks = 0;
    this.paused = false;
    this.lastMask = null;
  }

  Detector.prototype.setup = function () {
    var vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return false;
    this.width = this.frameWidth;
    this.height = Math.round((vh / vw) * this.frameWidth);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    var map = new Int32Array(GRID * GRID).fill(-1);
    var inside = 0;
    for (var j = 0; j < GRID; j++) {
      for (var i = 0; i < GRID; i++) {
        var b = gridToBoard(i, j);
        if (Math.hypot(b.x, b.y) > L.R.doubleOut + 4) continue;
        var p = apply(this.H, b.x, b.y);
        var u = Math.round(p.x), v = Math.round(p.y);
        if (u < 0 || v < 0 || u >= this.width || v >= this.height) continue;
        map[j * GRID + i] = v * this.width + u;
        inside++;
      }
    }
    this.map = map;
    this.inside = inside;
    var foot = cameraFoot(this.H, this.width, this.height);
    this.foot = { i: (foot.x + SPAN) / MM - 0.5, j: (SPAN - foot.y) / MM - 0.5 };
    this.footMm = foot;
    return inside > GRID * GRID * 0.3;
  };

  Detector.prototype.grab = function () {
    this.ctx.drawImage(this.video, 0, 0, this.width, this.height);
    var data = this.ctx.getImageData(0, 0, this.width, this.height).data;
    var out = new Float32Array(GRID * GRID);
    var map = this.map;
    for (var k = 0; k < out.length; k++) {
      var idx = map[k];
      if (idx < 0) continue;
      var o = idx * 4;
      out[k] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
    return out;
  };

  Detector.prototype.start = function () {
    var self = this;
    if (!this.setup()) {
      this.onStatus("error", "Het bord valt (deels) buiten beeld. Kalibreer opnieuw.");
      return false;
    }
    this.ref = null;
    this.prev = null;
    this.timer = setInterval(function () { self.tick(); }, 120);
    this.onStatus("ready", "Camera kijkt mee");
    return true;
  };

  Detector.prototype.stop = function () {
    clearInterval(this.timer);
    this.timer = null;
  };

  Detector.prototype.resetReference = function () {
    this.ref = null;
  };

  Detector.prototype.tick = function () {
    if (this.paused || this.video.readyState < 2) return;
    var cur = this.grab();
    var map = this.map;
    if (!this.prev) {
      this.prev = cur;
      return;
    }
    var moving = 0;
    for (var k = 0; k < cur.length; k++) {
      if (map[k] >= 0 && Math.abs(cur[k] - this.prev[k]) > this.sensitivity) moving++;
    }
    this.prev = cur;
    if (moving > this.inside * 0.002) {
      this.stableTicks = 0;
      this.onStatus("moving", "Beweging…");
      return;
    }
    this.stableTicks++;
    if (this.stableTicks < 4) return;
    if (!this.ref) {
      this.ref = cur;
      this.onStatus("ready", "Klaar voor de volgende dart");
      return;
    }
    if (this.stableTicks !== 4) {
      // Lang stil: pas de referentie heel langzaam aan op lichtverandering.
      if (this.stableTicks % 25 === 0) this.blendReference(cur);
      return;
    }
    this.compare(cur);
  };

  Detector.prototype.blendReference = function (cur) {
    for (var k = 0; k < cur.length; k++) {
      if (Math.abs(cur[k] - this.ref[k]) < this.sensitivity) this.ref[k] = 0.8 * this.ref[k] + 0.2 * cur[k];
    }
  };

  Detector.prototype.compare = function (cur) {
    var mask = new Uint8Array(GRID * GRID);
    var count = 0;
    for (var k = 0; k < cur.length; k++) {
      if (this.map[k] >= 0 && Math.abs(cur[k] - this.ref[k]) > this.sensitivity) {
        mask[k] = 1;
        count++;
      }
    }
    // Ruis eruit: een pixel telt alleen met minstens 2 veranderde buren.
    var clean = new Uint8Array(mask.length);
    var cleanCount = 0;
    for (var j = 1; j < GRID - 1; j++) {
      for (var i = 1; i < GRID - 1; i++) {
        var k2 = j * GRID + i;
        if (!mask[k2]) continue;
        var n = mask[k2 - 1] + mask[k2 + 1] + mask[k2 - GRID] + mask[k2 + GRID] +
          mask[k2 - GRID - 1] + mask[k2 - GRID + 1] + mask[k2 + GRID - 1] + mask[k2 + GRID + 1];
        if (n >= 2) { clean[k2] = 1; cleanCount++; }
      }
    }
    this.lastMask = clean;
    if (cleanCount < 12) return; // niets (genoeg) veranderd
    if (cleanCount > this.inside * 0.08) {
      this.ref = cur;
      this.onBigChange();
      return;
    }
    var blob = largestBlob(clean);
    if (blob.length < 10) return;
    var tip = this.tipOf(blob);
    var b = gridToBoard(tip.i, tip.j);
    var hit = L.scoreAt(b.x, b.y);
    hit.x = b.x;
    hit.y = b.y;
    this.ref = cur;
    this.onDart(hit);
  };

  Detector.prototype.tipOf = function (blob) {
    // Punt van de vlek die het dichtst bij de camera ligt; sla de 3 allerdichtste
    // pixels over zodat een losse ruispixel de uitkomst niet bepaalt.
    var f = this.foot;
    var withDist = blob.map(function (k) {
      var i = k % GRID, j = Math.floor(k / GRID);
      return { i: i, j: j, d: Math.hypot(i - f.i, j - f.j) };
    });
    withDist.sort(function (a, b) { return a.d - b.d; });
    var pick = withDist[Math.min(withDist.length - 1, 3)];
    return pick;
  };

  function largestBlob(mask) {
    var seen = new Uint8Array(mask.length);
    var best = [];
    var stack = [];
    for (var s = 0; s < mask.length; s++) {
      if (!mask[s] || seen[s]) continue;
      var comp = [];
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        var k = stack.pop();
        comp.push(k);
        var i = k % GRID;
        var nb = [k - GRID, k + GRID];
        if (i > 0) nb.push(k - 1);
        if (i < GRID - 1) nb.push(k + 1);
        for (var q = 0; q < nb.length; q++) {
          var m = nb[q];
          if (m >= 0 && m < mask.length && mask[m] && !seen[m]) {
            seen[m] = 1;
            stack.push(m);
          }
        }
      }
      if (comp.length > best.length) best = comp;
    }
    return best;
  }

  var api = {
    CALIB_POINTS: CALIB_POINTS,
    homography: homography,
    apply: apply,
    invert: invert,
    cameraFoot: cameraFoot,
    Detector: Detector,
    GRID: GRID,
    gridToBoard: gridToBoard,
    largestBlob: largestBlob,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DartVision = api;
})(typeof window !== "undefined" ? window : this);
