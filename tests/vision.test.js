const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../vision.js");

// Simpele pinhole-camera: positie C (mm), kijkt naar het bordmidden.
function camera(C, f, w, h) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const fwd = norm(sub([0, 0, 0], C));
  const right = norm(cross(fwd, [0, 1, 0]));
  const down = cross(fwd, right);
  return (x, y, z = 0) => {
    const d = sub([x, y, z], C);
    const zc = dot(d, fwd);
    return { x: w / 2 + (f * dot(d, right)) / zc, y: h / 2 + (f * dot(d, down)) / zc };
  };
}

test("homografie uit 4 kalibratiepunten klopt voor het hele bord", () => {
  const proj = camera([150, -400, 1300], 576, 640, 480);
  const img = V.CALIB_POINTS.map((p) => proj(p.x, p.y));
  const H = V.homography(V.CALIB_POINTS, img);
  for (const [x, y] of [[0, 0], [0, 103], [-80, 40], [120, -120]]) {
    const a = V.apply(H, x, y);
    const b = proj(x, y);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6);
  }
  const Hi = V.invert(H);
  const back = V.apply(Hi, ...Object.values(V.apply(H, 50, 60)));
  assert.ok(Math.abs(back.x - 50) < 1e-6 && Math.abs(back.y - 60) < 1e-6);
});

test("camerapositie wordt geschat uit de kalibratie", () => {
  for (const C of [[0, -500, 1200], [400, 0, 1000], [-300, -300, 1400]]) {
    const proj = camera(C, 576, 640, 480);
    const H = V.homography(V.CALIB_POINTS, V.CALIB_POINTS.map((p) => proj(p.x, p.y)));
    const foot = V.cameraFoot(H, 640, 480);
    assert.ok(Math.hypot(foot.x - C[0], foot.y - C[1]) < 30, JSON.stringify({ C, foot }));
  }
});

test("de punt van een dart ligt het dichtst bij de camera", () => {
  // Een dart die 100 mm uitsteekt richting de camera; in bovenaanzicht valt hij
  // verder van de camera af dan zijn punt.
  const C = [0, -600, 1200];
  const proj = camera(C, 576, 640, 480);
  const H = V.homography(V.CALIB_POINTS, V.CALIB_POINTS.map((p) => proj(p.x, p.y)));
  const Hi = V.invert(H);
  const tip = [20, 100];
  const tail = [tip[0] - 5, tip[1] + 25, 100]; // flight hoger en naar voren
  const t0 = V.apply(Hi, ...Object.values(proj(...tip)));
  const t1 = V.apply(Hi, ...Object.values(proj(...tail)));
  const foot = V.cameraFoot(H, 640, 480);
  const d = (p) => Math.hypot(p.x - foot.x, p.y - foot.y);
  assert.ok(d(t0) < d(t1));
  assert.ok(Math.hypot(t0.x - tip[0], t0.y - tip[1]) < 1e-6);
});
