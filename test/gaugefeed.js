// node test/gaugefeed.js — values from the Smart Gauge screen (MFB-LINK LIVE 0x21 / LOG_GET 0x22) -> the app (src/gaugefeed.js, pure part)
const assert = require('assert');
const fs = require('fs');
const G = require('../src/gaugefeed.js');
const T = require('../src/tune.js');

// ---- build the bytes the screen sends (layout of the firmware README, v1.0.15) ----
const w16 = (b, i, v) => { b[i] = v & 255; b[i + 1] = (v >> 8) & 255; };
const w32 = (b, i, v) => { w16(b, i, v & 0xFFFF); w16(b, i + 2, (v >>> 16) & 0xFFFF); };
function liveBytes(o) {
  const b = new Array(48).fill(0); b[0] = 1; b[1] = o.kline ? 1 : 0; b[2] = (o.linked ? 1 : 0) | (o.demo ? 2 : 0) | (o.diesel ? 4 : 0) | (o.bike ? 16 : 0);
  let f = 0; const put = (bit, i, x, mul) => { if (x == null) return; f |= 1 << bit; w16(b, i, Math.round(x * mul) & 0xFFFF); };
  put(0, 6, o.rpm, 1); put(1, 8, o.speed, 10); put(2, 10, o.tps, 10); put(3, 12, o.map, 10); put(4, 14, o.ect, 10); put(5, 16, o.iat, 10); put(6, 18, o.batt, 100);
  put(7, 20, o.timing, 10); put(8, 22, o.inj, 100); put(9, 24, o.afr, 100); put(10, 26, o.lambda, 1000); put(14, 36, o.oil, 10); put(15, 38, o.load, 10);
  if (o.crpV != null) { f |= 1 << 11; w16(b, 28, 12); w16(b, 30, Math.round(o.crpV * 1000)); }
  w16(b, 4, f); w32(b, 40, o.tripM || 0); w32(b, 44, o.tripS || 0);
  return b;
}
function mapBytes(rpmStepX100, tps, cells) {                  // kind 2: 4 + rows + rows*cols*4
  const rows = tps.length, cols = 8, b = [2, rows, cols, rpmStepX100, ...tps];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = (cells[r] && cells[r][c]) || { n: 0, avg: 0 }; b.push(x.n & 255, x.n >> 8, Math.round(x.avg * 100) & 255, Math.round(x.avg * 100) >> 8); }
  return b;
}

// ---- LIVE decoding, the same as the firmware's own gauge_sync.js ----
const full = { rpm: 3250, speed: 62.5, tps: 18.4, map: 41.2, ect: 88.5, iat: 33.1, batt: 13.82, timing: 24.5, inj: 2.34, afr: 14.2, lambda: 0.966, oil: 96.4, load: 37.6, crpV: 2.5, linked: true, bike: true, kline: true, tripM: 12345, tripS: 678 };
const L = G.decodeLive(liveBytes(full));
assert.strictEqual(L.rpm, 3250); assert.strictEqual(L.speed, 62.5); assert.strictEqual(L.tps, 18.4); assert.strictEqual(L.ect, 88.5); assert.strictEqual(L.batt, 13.82);
assert.strictEqual(L.afr, 14.2); assert.strictEqual(L.mode, 'kline'); assert(L.linked && L.bike && !L.demo); assert.strictEqual(L.tripKm, 12.345); assert.strictEqual(L.tripSec, 678);
const fw = '/home/claude/jetsmartgaugecar/gauge_sync.js';
if (fs.existsSync(fw)) {
  const F = require(fw);
  assert.deepStrictEqual(L, F.decodeLive(liveBytes(full)), 'same as the firmware repo decoder');
  const sparse = liveBytes({ rpm: 800, afr: 14.7 }), neg = liveBytes({ ect: -12.3, iat: -4, timing: -3.5 });
  assert.deepStrictEqual(G.decodeLive(sparse), F.decodeLive(sparse)); assert.deepStrictEqual(G.decodeLive(neg), F.decodeLive(neg));
  const mb = mapBytes(10, [0, 5, 10, 20, 35, 50, 75], [[{ n: 5, avg: 14.7 }], [], [], [{ n: 300, avg: 13.25 }]]);
  assert.deepStrictEqual(G.decodeLog(mb), F.decodeLog(mb), 'AFR map same as the firmware repo decoder');
  console.log('  decoders identical to the firmware repo gauge_sync.js');
}
assert.strictEqual(G.decodeLive(liveBytes({ ect: -12.3 })).ect, -12.3);
assert.strictEqual(G.decodeLive(new Array(47).fill(0)), null, 'short frame');
assert.strictEqual(G.decodeLive([2, ...new Array(47).fill(0)]), null, 'unknown version');
assert.strictEqual(G.decodeLive(liveBytes({ rpm: 1000 })).tps, null, 'a value without its valid bit is null');

// ---- into the app's keys ----
const { d, gk } = G.liveToD(L);
assert.deepStrictEqual(Object.keys(d).sort(), ['AFR', 'BATT', 'CRP', 'ECT', 'EOT', 'IAT', 'IGN', 'INJ', 'LAMB', 'LOAD', 'MAP', 'RPM', 'SPD', 'TPS'].sort());
assert.strictEqual(d.RPM, 3250); assert.strictEqual(d.SPD, 62.5); assert.strictEqual(d.IGN, 24.5); assert.strictEqual(d.EOT, 96.4); assert.strictEqual(d.CRP, 2.5); assert.strictEqual(d.LAMB, 0.966);
assert.deepStrictEqual(Object.keys(gk).sort(), Object.keys(d).sort(), 'every key is marked as coming from the screen');
const z = G.liveToD(G.decodeLive(liveBytes({ rpm: 900, afr: 0, lambda: 0 })));
assert.deepStrictEqual(Object.keys(z.d), ['RPM'], 'AFR 0 / lambda 0 = no wideband: not a value');
assert.deepStrictEqual(G.liveToD(null).d, {});
assert.deepStrictEqual(Object.keys(G.liveToD(G.decodeLive(liveBytes({ linked: true }))).d), [], 'a screen with nothing valid gives nothing');
console.log('  LIVE -> app keys ok');

// ---- the screen's AFR map -> the app's AFR LOG ----
const info = { rpmRows: true, mul: 1, load: 'TPS' }, ys = [], xs = [];
for (let i = 0; i < 20; i++) ys.push(1000 + i * 500); for (let i = 0; i < 13; i++) xs.push(Math.round(i * 100 / 12));   // 1000 .. 10500 rpm x 0 .. 100 %
const TPS = [0, 5, 10, 20, 35, 50, 75];
const rowOf = (r) => Math.round(T.axisPos(ys, r)), colOf = (c) => Math.round(T.axisPos(xs, c));
const m1 = G.decodeLog(mapBytes(10, TPS, [[], [], [{ n: 0 }, { n: 0 }, { n: 40, avg: 14.5 }], [], [], [], [{ n: 0 }, { n: 0 }, { n: 0 }, { n: 0 }, { n: 0 }, { n: 0 }, { n: 25, avg: 12.4 }]]));
const p1 = G.importPlan(m1, {}, ys, xs, info, T.axisPos);
assert.strictEqual(p1.added, 65); assert.strictEqual(p1.spots, 2);
const a = p1.cells.find((x) => x.n === 40), b = p1.cells.find((x) => x.n === 25);
assert.deepStrictEqual([a.r, a.c, a.avg], [rowOf(2500), colOf(15), 14.5], 'row 2 (10-20 %), column 2 (2000-3000 rpm -> 2500) -> the app cell at 2,500 rpm / 15 %');
assert.deepStrictEqual([b.r, b.c, b.avg], [rowOf(6500), colOf(87.5), 12.4], 'WOT row (75-100 % -> 87.5), column 6 (6000-7000 -> 6500)');
// the same map again: nothing new
const p2 = G.importPlan(m1, p1.snap, ys, xs, info, T.axisPos); assert.strictEqual(p2.added, 0); assert.strictEqual(p2.cells.length, 0);
// the screen kept logging: only the difference comes in, with the right average
const m2 = G.decodeLog(mapBytes(10, TPS, [[], [], [{ n: 0 }, { n: 0 }, { n: 140, avg: 14.2 }]]));         // 40 samples of 14.5 + 100 more -> average 14.2 means the new 100 averaged (140*14.2 - 40*14.5)/100 = 14.08
const p3 = G.importPlan(m2, p1.snap, ys, xs, info, T.axisPos);
assert.strictEqual(p3.added, 100); assert(Math.abs(p3.cells[0].avg - 14.08) < 0.02, 'avg of the new part ' + p3.cells[0].avg);
// the screen's log was cleared (fewer samples than the snapshot): take everything again
const m3 = G.decodeLog(mapBytes(10, TPS, [[], [], [{ n: 0 }, { n: 0 }, { n: 7, avg: 13.9 }]]));
const p4 = G.importPlan(m3, p1.snap, ys, xs, info, T.axisPos); assert.strictEqual(p4.added, 7); assert.strictEqual(p4.cells[0].avg, 13.9);
// a motorcycle screen counts 2000 rpm per column
const bike = G.decodeLog(mapBytes(20, TPS, [[], [], [{ n: 0 }, { n: 0 }, { n: 0 }, { n: 12, avg: 13.1 }]]));
const p5 = G.importPlan(bike, {}, ys, xs, info, T.axisPos); assert.strictEqual(p5.cells[0].r, rowOf(7000), 'column 3 x 2000 rpm = 6000-8000 -> 7000');
// axes the other way round (RPM across, throttle down) and an axis scaled by 100 (98 = 9800 rpm)
const ysT = xs, xsR = ys.map((v) => v / 100), info2 = { rpmRows: false, mul: 100, load: 'TPS' };
const p6 = G.importPlan(m1, {}, ysT, xsR, info2, T.axisPos); const a6 = p6.cells.find((x) => x.n === 40);
assert.deepStrictEqual([a6.r, a6.c], [Math.round(T.axisPos(ysT, 15)), Math.round(T.axisPos(xsR, 25))]);
// a MAP-based table or a missing log cannot take it
assert.strictEqual(G.importPlan(m1, {}, ys, xs, { rpmRows: true, mul: 1, load: 'MAP' }, T.axisPos), null);
assert.strictEqual(G.importPlan(null, {}, ys, xs, info, T.axisPos), null);
assert.strictEqual(G.importPlan(G.decodeLog([0, 8, 8, 10, ...new Array(64).fill(0)]), {}, ys, xs, info, T.axisPos), null, 'only the map (kind 2) is imported');
// an impossible average is left out
const bad = G.decodeLog(mapBytes(10, TPS, [[{ n: 3, avg: 2.5 }]])); assert.strictEqual(G.importPlan(bad, {}, ys, xs, info, T.axisPos).added, 0);
// short / damaged table
assert.strictEqual(G.decodeLog(mapBytes(10, TPS, []).slice(0, 40)), null);
console.log('  AFR map import ok');
console.log('v1.6.10 gauge -> app tests passed');
