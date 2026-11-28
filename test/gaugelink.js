// node test/gaugelink.js — the phone as an ELM327 for the Jet_SmartGauge_CAR screen (src/gaugelink.js ElmEmu)
const assert = require('assert');
const { ElmEmu, OFFER } = require('../src/gaugelink.js');

// ---- a faithful JS port of what the screen firmware (v1.0.13 main.cpp) does with the replies: parseMsgs, queryMulti, bitmaps, decodePid ----
const hv = (c) => parseInt(c, 16);
function parseMsgs(raw) {                         // main.cpp parseMsgs: one reply = list of messages
  const out = []; let mf = -1, expect = 0;
  for (const line of raw.split(/[\r\n]+/)) {
    const ln = line.replace(/ /g, ''); if (!ln) continue;
    let p = ln, frame = false;
    if (ln.length >= 2 && ln[1] === ':') { frame = true; p = ln.slice(2); }
    if (!/^[0-9a-fA-F]+$/.test(p)) continue;      // SEARCHING..., NO DATA, echoes ...
    if (frame) { if (mf < 0) { mf = out.length; out.push([]); expect = 255; } for (let j = 0; j + 1 < p.length; j += 2) out[mf].push(hv(p.substr(j, 2))); if (out[mf].length >= expect) mf = -1; continue; }
    mf = -1;
    if (p.length === 3) { mf = out.length; out.push([]); expect = hv(p); continue; }
    if (p.length & 1) continue;
    const m = []; for (let j = 0; j + 1 < p.length; j += 2) m.push(hv(p.substr(j, 2))); out.push(m);
  }
  return out;
}
const PIDLEN = { 0x04: 1, 0x05: 1, 0x0B: 1, 0x0D: 1, 0x0E: 1, 0x0F: 1, 0x11: 1, 0x33: 1, 0x46: 1, 0x5C: 1, 0x0C: 2, 0x10: 2, 0x42: 2, 0x24: 4 };
const dec = (id, b) => { const A = b[0], AB = A * 256 + (b[1] || 0);
  return ({ 0x04: A * 100 / 255, 0x05: A - 40, 0x0B: A, 0x0C: AB / 4, 0x0D: A, 0x0E: A / 2 - 64, 0x0F: A - 40, 0x10: AB / 100, 0x11: A * 100 / 255, 0x24: AB * 2 / 65536, 0x33: A, 0x42: AB / 1000, 0x46: A - 40, 0x5C: A - 40 })[id]; };
function queryMulti(ids, raw) {
  const got = {};
  for (const m of parseMsgs(raw)) {
    if (m.length < 3 || m[0] !== 0x41) continue;
    let j = 1;
    while (j < m.length) { const pid = m[j], len = PIDLEN[pid]; if (!len || j + 1 + len > m.length) break; if (ids.includes(pid)) got[pid] = dec(pid, m.slice(j + 1, j + 1 + len)); j += 1 + len; }
  }
  return got;
}

// ---- the emulator with values the app would have read ----
let vals = { RPM: 2500, SPD: 62, TPS: 40, ECT: 88, IAT: 31, MAP: 55, LOAD: 33, IGN: 18.5, BATT: 13.8, LAMBDA: 0.9, BARO: 100, EOT: 95 };
let fresh = true, sent = [];
const emu = new ElmEmu({ value: (k) => (fresh && vals[k] != null ? vals[k] : null), out: (t) => sent.push(t) });
const ask = (cmd) => { sent = []; emu.feed(Array.from(cmd + '\r', (c) => c.charCodeAt(0))); return sent.join(''); };

// 1) screen start-up as in elmInit(): ATZ must say ELM, ATE0 OK, ATL0/S0/H0, ATSP, 0100, ATDPN
{ let r = ask('ATZ'); assert(r.indexOf('ELM') >= 0, 'ATZ -> ELM327'); assert(r.endsWith('\r\r>'));
  r = ask('ATE0'); assert(r.indexOf('OK') >= 0); assert(r.startsWith('ATE0\r'), 'echo was still on for ATE0 itself');
  r = ask('ATE0'); assert(!r.startsWith('ATE0'), 'echo off now'); assert(r === 'OK\r\r>');
  for (const c of ['ATL0', 'ATS0', 'ATH0', 'ATSP0', 'ATSP6', 'ATST19', 'ATAT1', 'ATST32', 'ATST64']) assert.strictEqual(ask(c), 'OK\r\r>', c);
  const p = parseMsgs(ask('0100')); assert(p.length === 1 && p[0][0] === 0x41 && p[0][1] === 0x00, '0100 answers like a car (replyIs0100)');
  const dpn = ask('ATDPN'); let proto = 0; for (const ch of dpn.replace(/[\r>]/g, '')) if (ch >= '1' && ch <= '9') { proto = +ch; break; }
  assert.strictEqual(proto, 6, 'the screen reads protocol 6 (CAN) -> several PIDs per request');
  assert.strictEqual(ask('ATXYZ'), '?\r\r>'); }
console.log('✔ start-up sequence');

// 2) support bitmaps: the screen walks 0100, 0120, 0140 while bit 32 of each says "more"
{ const psup = new Set(); let base = 0;
  for (; base < 0xE0; base += 0x20) {
    const m = parseMsgs(ask('01' + (base < 16 ? '0' : '') + base.toString(16).toUpperCase().padStart(2, '0')))[0];
    assert(m && m[0] === 0x41 && m[1] === base && m.length === 6, 'bitmap ' + base);
    const b = m.slice(2); for (let i = 0; i < 32; i++) if (b[i >> 3] & (0x80 >> (i & 7))) psup.add(base + i + 1);
    if (!(b[3] & 1)) break;
  }
  assert.strictEqual(base, 0x40, 'stops after the 0x40 range (nothing above 0x60)');
  for (const id of Object.keys(OFFER)) assert(psup.has(+id) || +id === 0x20 || +id === 0x40, 'PID ' + (+id).toString(16) + ' is announced');
  for (const id of [0x0C, 0x0D, 0x05, 0x11, 0x24, 0x42]) assert(psup.has(id));
  assert(!psup.has(0x06) && !psup.has(0x23), 'what the app cannot give is not announced'); }
console.log('✔ support bitmaps');

// 3) the values: one PID, the "number of replies" digit, and six PIDs in one request (what the CAN polling sends)
{ let g = queryMulti([0x0C], ask('010C1')); assert.strictEqual(g[0x0C], 2500);
  g = queryMulti([0x0C, 0x0D], ask('010C0D1')); assert.strictEqual(g[0x0C], 2500); assert.strictEqual(g[0x0D], 62);
  g = queryMulti([0x0C, 0x0D, 0x11, 0x05, 0x0B, 0x0F], ask('010C0D11050B0F1'));
  assert.strictEqual(g[0x0C], 2500); assert.strictEqual(g[0x0D], 62); assert(Math.abs(g[0x11] - 40) < 0.5); assert.strictEqual(g[0x05], 88); assert.strictEqual(g[0x0B], 55); assert.strictEqual(g[0x0F], 31);
  g = queryMulti([0x0E, 0x42, 0x24, 0x04, 0x5C, 0x10], ask('010E4224045C101')); assert.strictEqual(g[0x0E], 18.5); assert.strictEqual(g[0x42], 13.8);
  assert(Math.abs(g[0x24] - 0.9) < 0.001, 'lambda 0.9 -> AFR 13.2'); assert(Math.abs(g[0x04] - 33) < 0.5); assert.strictEqual(g[0x5C], 95); assert.strictEqual(g[0x10], undefined, 'MAF has no value: left out');
  assert.strictEqual(ask('010C'), '410C2710\r\r>', 'ATS0 was sent in the start-up: no spaces');
  ask('ATS1'); assert.strictEqual(ask('010C'), '41 0C 27 10\r\r>', 'spaces back on'); ask('ATS0'); }
console.log('✔ values, single + combined requests');

// 4) no data / stale data / things not offered
{ fresh = false; assert.strictEqual(ask('010C1'), 'NO DATA\r\r>', 'app not reading the car'); assert.strictEqual(ask('01 0C 0D 1'), 'NO DATA\r\r>');
  fresh = true; vals = Object.assign({}, vals, { RPM: undefined }); assert.strictEqual(ask('010C1'), 'NO DATA\r\r>'); let g = queryMulti([0x0C, 0x0D], ask('010C0D1')); assert.strictEqual(g[0x0D], 62, 'one value missing: the other still comes'); assert.strictEqual(g[0x0C], undefined);
  vals.RPM = 0; assert.strictEqual(queryMulti([0x0C], ask('010C1'))[0x0C], 0, 'engine stopped = 0 rpm, not "no data"');
  for (const c of ['0902', '090A', '03', '04', '0201 00']) assert.strictEqual(ask(c), 'NO DATA\r\r>', c);
  assert.strictEqual(ask('01FF1'), 'NO DATA\r\r>'); assert.strictEqual(ask('ZZ'), '?\r\r>'); assert.strictEqual(ask('01'), '?\r\r>'); }
console.log('✔ no data / unsupported');

// 5) bytes arrive in pieces (BLE writes of 20 bytes), commands may be lower case / have spaces
{ sent = []; for (const ch of '01 0c 0d 1\r') emu.feed([ch.charCodeAt(0)]); const g = queryMulti([0x0C, 0x0D], sent.join('')); assert.strictEqual(g[0x0D], 62);
  emu.feed(Array.from('AT Z\r', (c) => c.charCodeAt(0))); assert.strictEqual(emu.echo, true, 'ATZ resets echo'); }
console.log('✔ byte-wise input');

// 5b) what the screen asked for is counted (shown in the app's "data synced with the screen" panel)
{ emu.stats(); fresh = true; vals.RPM = 2500; ask('010C0D1'); ask('010C1'); ask('01061'); ask('01231'); ask('03'); ask('0902'); ask('0902');
  assert.strictEqual(emu.hits[0x0C].n, 2); assert.strictEqual(emu.hits[0x0C].ok, 2); assert.strictEqual(emu.hits[0x0D].n, 1);
  fresh = false; ask('010C1'); assert.strictEqual(emu.hits[0x0C].n, 3); assert.strictEqual(emu.hits[0x0C].ok, 2, 'asked but no value is not counted as sent'); fresh = true;
  assert.strictEqual(emu.miss['PID 06'].n, 1); assert.strictEqual(emu.miss['PID 23'].n, 1); assert.strictEqual(emu.miss['เลข VIN / ข้อมูล ECU'].n, 2); assert(emu.miss['อ่านโค้ดเสีย (DTC)'].n === 1);
  assert(emu.n >= 8); emu.stats(); assert.strictEqual(emu.n, 0); assert.deepStrictEqual(emu.hits, {}); }
console.log('✔ request statistics');

// 6) the app's own ELM327 client talks to it end to end (a second, independent reader of the same protocol)
(async () => {
  const { Elm327 } = require('../src/elm.js');
  vals = { RPM: 3200, SPD: 80, TPS: 30, ECT: 90, IAT: 30, MAP: 70, LOAD: 50, IGN: 20, BATT: 14.0, LAMBDA: 1.0 }; fresh = true;
  const e2 = new ElmEmu({ value: (k) => (vals[k] != null ? vals[k] : null), out: (t) => setTimeout(() => stream.onData && stream.onData(Array.from(t, (c) => c.charCodeAt(0))), 1) });
  const stream = { write: async (b) => e2.feed(b), close: async () => {} };
  const el = new Elm327(stream, { log: () => {} }); await el.init(); assert.strictEqual(el.state, 'OK', 'client sees a working car');
  let d = null; for (let i = 0; i < 6 && !(d && d.RPM); i++) d = await el.readLive();
  assert(d && Math.abs(d.RPM - 3200) < 1 && d.SPD === 80 && d.ECT === 90, 'client reads the values back: ' + JSON.stringify(d));
  console.log('✔ the app\'s own ELM327 client reads the phone-emulated adapter');
  console.log('gaugelink tests passed');
})().catch((x) => { console.error(x); process.exit(1); });
