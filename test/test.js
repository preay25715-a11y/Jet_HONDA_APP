// node test/test.js  — protocol + full ECU workflow against the simulator
const assert = require('assert');
const P = require('../src/proto.js');
const { HondaECU } = require('../src/ecu.js');
const { SimTransport } = require('../src/sim.js');

(async () => {
  // known frames from the Honda K-line protocol notes
  assert.deepStrictEqual(P.buildFrame([0xFE], [0x72]), [0xFE, 0x04, 0x72, 0x8C]);
  assert.deepStrictEqual(P.buildFrame([0x72], [0x00, 0xF0]), [0x72, 0x05, 0x00, 0xF0, 0x99]);
  assert.deepStrictEqual(P.buildFrame([0x72], [0x71, 0x11]), [0x72, 0x05, 0x71, 0x11, 0x07]);
  assert.deepStrictEqual(P.buildFrame([0x72], [0x71, 0x17]), [0x72, 0x05, 0x71, 0x17, 0x01]);
  assert.deepStrictEqual(P.buildFrame([0x72], [0x71, 0x00]), [0x72, 0x05, 0x71, 0x00, 0x18]);
  assert.deepStrictEqual(P.parseReply([0x0E, 0x04, 0x72, 0x7C], 1).data, [0x72]);
  assert.deepStrictEqual(P.parseReply([0x02, 0x04, 0x00, 0xFA], 1).data, [0x00]);
  assert.deepStrictEqual(P.fmtRead(0x012345), [0x01, 0x45, 0x23]);
  // link framing round trip
  let got = null; const lp = new P.LinkParser((t, p) => (got = [t, p]));
  const enc = P.linkEncode(0x03, [1, 2, 3, 250]);
  lp.push([9, 9, ...enc.slice(0, 4)]); assert.strictEqual(got, null); lp.push(enc.slice(4));
  assert.deepStrictEqual(got, [0x03, [1, 2, 3, 250]]);
  console.log('✔ framing');

  const sim = new SimTransport({ latency: 0 });
  const ecu = new HondaECU(sim);
  assert.strictEqual(await ecu.detect(), 'OK');
  console.log('✔ detect OK, id', P.hex(ecu.ecuId));
  const live = await ecu.readLive(); assert(live && live.RPM > 0); console.log('✔ live', live);
  const dtc = await ecu.readDTC(); assert.deepStrictEqual(dtc.current, ['7-1', '21-1']); console.log('✔ dtc', dtc);
  assert(await ecu.clearDTC()); assert.deepStrictEqual((await ecu.readDTC()).current, []);

  // READ (with a few dropped frames to exercise retries)
  sim.failNext = 3;
  const img = await ecu.readFlash({ start: 0x8000, maxBytes: 0x100000 });
  assert.strictEqual(img.length, 65536, 'auto size');
  assert.deepStrictEqual(Array.from(img), Array.from(sim.flash));
  assert(P.binChecksumOK(img));
  console.log('✔ read 64KB auto-size, checksum OK, stats', ecu.stats);

  // edit + fix checksum + WRITE
  const mod = new Uint8Array(img); mod[0x4000] ^= 0x55; mod[0x4001] = 0x12;
  assert(!P.binChecksumOK(mod));
  const fixed = P.binFixChecksum(mod, 0); assert(P.binChecksumOK(fixed));
  const stages = [];
  const ok = await ecu.writeFlash(fixed, { start: 0x8000, fast: true, onStage: (s) => stages.push(s) });
  assert(ok, 'write ok'); assert.deepStrictEqual(Array.from(sim.flash), Array.from(fixed));
  assert.strictEqual(sim.mode, 'OK');
  console.log('✔ write + verify:', stages.join(' | '));

  // gate: write refused if checksum bad
  await assert.rejects(ecu.writeFlash(mod, { start: 0x8000, fast: true }));
  // EEPROM
  const ee = await ecu.eepromRead(); assert.strictEqual(ee.length, 256);
  ee[5] = 0xAB; await ecu.eepromWrite(ee); assert.strictEqual((await ecu.eepromRead())[5], 0xAB);
  assert(await ecu.eepromFormat(true)); assert.strictEqual((await ecu.eepromRead())[0], 0xFF);
  console.log('✔ eeprom read/write/format');

  // security-required ECU
  const sim2 = new SimTransport({ latency: 0, requirePw: true }); const e2 = new HondaECU(sim2);
  await e2.detect(); assert.strictEqual((await e2.readFlash({ start: 0x8000, maxBytes: 64 })).length, 0);
  assert(await e2.unlock(P.parseHexBytes('01 02 03 04 05 06 07 08')));
  assert.strictEqual((await e2.readFlash({ start: 0x8000, maxBytes: 64 })).length, 64);
  console.log('✔ security unlock');

  // ---- tune engine
  const T = require('../src/tune.js'); const { makeImage } = require('../src/sim.js');
  const im = makeImage(65536), tabs = T.parseXDF(P.DEMO_XDF);
  assert.strictEqual(tabs.length, 2); const ft = T.readTable(im, tabs[0]);
  assert.strictEqual(ft.ys[0], 840); assert.strictEqual(ft.xs[24], 72); assert(Math.abs(ft.vals[0][0] - 4.72) < 0.002);
  const im2 = new Uint8Array(im); assert.strictEqual(T.writeCell(im2, tabs[0], 5, 5, 6.5), 6.5);
  assert.strictEqual(T.readTable(im2, tabs[0]).vals[5][5], 6.5);
  // little-endian, signed, column-major, BASEOFFSET subtract, labels axis, nonlinear eq
  const x2 = `<XDFFORMAT><XDFHEADER><BASEOFFSET offset="0x8000" subtract="1" /></XDFHEADER><XDFTABLE><title>t</title>
   <XDFAXIS id="x"><indexcount>3</indexcount><LABEL index="0" value="10"/><LABEL index="1" value="20"/><LABEL index="2" value="30"/></XDFAXIS>
   <XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x07" mmedaddress="0x8010" mmedelementsizebits="16" mmedrowcount="2" mmedcolcount="3"/><MATH equation="X*X*X/1000"><VAR id="X"/></MATH></XDFAXIS></XDFTABLE></XDFFORMAT>`;
  const t2 = T.parseXDF(x2)[0]; assert.strictEqual(t2.z.addr, 0x10); assert(t2.z.lsb && t2.z.signed && t2.z.colMajor);
  const b2 = new Uint8Array(64); T.rawSet(b2, t2.z, T.cellAddr(t2.z, 1, 2), -300);
  assert.strictEqual(T.rawGet(b2, t2.z, 0x10 + (2 * 2 + 1) * 2), -300); assert.strictEqual(b2[0x10 + 10], 0xD4);
  assert.deepStrictEqual(T.readTable(b2, t2).xs, [10, 20, 30]);
  T.writeCell(b2, t2, 0, 0, 343); assert.strictEqual(T.rawGet(b2, t2.z, 0x10), 70);
  const lg = new T.AfrLog(2, 2); lg.add(0, 1, 13); lg.add(0.4, 1.2, 14); assert.strictEqual(lg.get(0, 1).avg, 13.5);
  assert.strictEqual(T.fitFactor(14, 13, 15).toFixed(4), (14 / 13).toFixed(4)); assert.strictEqual(T.fitFactor(20, 13, 15), 1.15);
  const sens = P.decodeSensors([0x76, 0x04, 0xD0, 0x04, 19, 26, 0x40, 0x6C, 0x32, 0x08, 0x08, 0x61, 0xE7, 0x3B, 118, 81, 0, 0x0F]);
  assert.strictEqual(sens.afr, 11.42); assert.strictEqual(sens.spd, 123.2); assert(sens.gpsOk && sens.afrOk); assert.strictEqual(sens.eot, 78);
  console.log('✔ tune engine (XDF / LE / signed / col-major / AFR log / fit / sensors)');
  console.log('\nALL TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

// ---- ELM327 / OBD-II driver ----
(async () => {
  const { Elm327, FakeElm } = require('../src/elm.js');
  for (const diesel of [false, true]) {
    const e = new Elm327(new FakeElm({ diesel })); await e.init();
    assert.strictEqual(e.fuel, diesel ? 'd' : 'g');
    let d; for (let i = 0; i < 9; i++) d = await e.readLive();
    assert(d.RPM > 600 && d.ECT === 90 && d.SPD === 62 && Math.abs(d.BATT - 14) < 0.1, 'elm live');
    if (diesel) assert(d.BOOST > 100 && d.FRP === 30000, 'diesel pids');
    assert.deepStrictEqual((await e.readDTC()).current, ['P0301', 'P0420']);
    assert(await e.clearDTC()); assert.deepStrictEqual((await e.readDTC()).current, []);
  }
  console.log('ELM327 tests passed');
})().catch((x) => { console.error(x); process.exit(1); });

// ---- ELM327: lambda PID, older protocols (one PID per request) ----
(async () => {
  const { Elm327, FakeElm } = require('../src/elm.js');
  for (const o of [{ lambda: true }, { lambda: true, noMulti: true }, { lambda: false }]) {
    const e = new Elm327(new FakeElm(o)); await e.init();
    assert.strictEqual(e.single, !!o.noMulti);
    let d; for (let i = 0; i < 14; i++) d = await e.readLive();
    assert(d.RPM > 600 && d.ECT === 90 && d.SPD === 62 && d.TPS > 10, 'live ' + JSON.stringify(o));
    if (o.lambda) assert(Math.abs(d.LAMB - 0.98) < 0.05, 'lambda ' + d.LAMB); else assert(d.LAMB === undefined);
  }
  console.log('ELM327 v1.3.1 tests passed');
})().catch((x) => { console.error(x); process.exit(1); });

// ---- ELM327 emulation by the HONDA-KLINE bridge (protocol H, one PID per request, PID D1 injector, blink-code DTC) ----
(async () => {
  const { Elm327, FakeElm } = require('../src/elm.js');
  const e = new Elm327(new FakeElm({ honda: true })); await e.init();
  assert.strictEqual(e.honda, true, 'honda bridge detected');
  assert.strictEqual(e.single, true, 'one PID per request');
  assert.strictEqual(e.fuel, 'g', 'bike = petrol');
  let d; for (let i = 0; i < 14; i++) d = await e.readLive();
  assert(d.RPM > 600 && d.ECT === 90 && d.TPS > 10, 'live ' + JSON.stringify(d));
  assert(Math.abs(d.INJ - 6) < 0.01, 'INJ (PID D1, 0.01 ms) ' + d.INJ);
  const t = await e.readDTC();
  assert(t.current.includes('12-1') && t.current.includes('21-2'), 'blink codes ' + JSON.stringify(t));
  console.log('HONDA-KLINE bridge tests passed', JSON.stringify(t));
})().catch((x) => { console.error(x); process.exit(1); });

// ---- v1.5: identification (VIN), fuel type, channel list, EQR-only AFR source ----
(async () => {
  const { Elm327, FakeElm } = require('../src/elm.js');
  for (const kwp of [false, true]) {
    const e = new Elm327(new FakeElm({ vin: 'MM8DJ2HAW0W123456', cal: 'CAL12345', kwp })); await e.init();
    assert.strictEqual(e.ident.vin, 'MM8DJ2HAW0W123456', 'VIN ' + (kwp ? 'kwp' : 'can') + ' = ' + e.ident.vin);
    assert.strictEqual(e.ident.cal, 'CAL12345', 'cal id ' + e.ident.cal);
  }
  const g = new Elm327(new FakeElm({ eqr: true, lambda: false })); await g.init();
  assert.strictEqual(g.fuel, 'g'); assert.strictEqual(g.stoich, 14.7);
  const kg = g.channelKeys(); assert(kg.has('AFR') && kg.has('EQR') && kg.has('BATT') && !kg.has('LAMB'), 'petrol keys');
  let d; for (let i = 0; i < 14; i++) d = await g.readLive();
  assert(d.EQR > 0.9 && d.EQR < 1.1, 'EQR ' + d.EQR);
  const dd = new Elm327(new FakeElm({ diesel: true })); await dd.init();
  assert.strictEqual(dd.fuel, 'd'); assert.strictEqual(dd.stoich, 14.5);
  const kd = dd.channelKeys(); assert(kd.has('BOOST') && kd.has('FRP') && kd.has('EGT1') && !kd.has('IGN'), 'diesel keys ' + [...kd]);
  console.log('v1.5 elm tests passed (VIN can/kwp, petrol EQR-only, diesel keys)');
})().catch((x) => { console.error(x); process.exit(1); });

// ---- v1.5.1: multi-frame CAN answers, response-count digit, clone adapters (KONNWEI KW90x), rotating queue ----
(async () => {
  const { Elm327, FakeElm } = require('../src/elm.js');
  // 1) _join: byte-count line + numbered lines become ONE message (long CAN answers); single lines pass through
  const j = new Elm327(new FakeElm({}));
  // 0x00B = 11 bytes announced: 6 in frame 0 + 5 of the 7 in frame 1 (the rest is padding and must be dropped)
  assert.deepStrictEqual(j._join(['00B', '0: 41 0C 1A F8 0D 3E', '1: 11 40 05 7B 00 AA AA']), ['410C1AF80D3E1140057B00'], 'multi-frame join');
  assert.deepStrictEqual(j._join(['41 0C 1A F8']), ['410C1AF8']); assert.deepStrictEqual(j._join(['SEARCHING...', 'NO DATA', '?']), []);
  // 2) CAN adapter with the response-count digit: all values come back (multi-frame), several PIDs per request, ≤ 3 requests per cycle, RPM every cycle
  { const f = new FakeElm({ latency: 1 }), e = new Elm327(f); await e.init();
    assert.strictEqual(e.useCnt, true, 'count digit accepted'); assert.strictEqual(e.tuned, true, 'AT2 accepted'); assert.strictEqual(e.single, false);
    f.pidCount = {}; const n0 = f.nreq; let d; for (let i = 0; i < 40; i++) d = await e.readLive();
    assert.strictEqual(e.single, false, 'long CAN answers must not push the driver into one-PID mode');
    assert(d.RPM > 600 && d.ECT === 90 && d.SPD === 62 && d.TPS > 10 && d.BATT > 13, 'live ' + JSON.stringify(d));
    assert((f.nreq - n0) / 40 <= 3.2, 'requests per cycle ' + (f.nreq - n0) / 40); assert.strictEqual(f.pidCount[0x0C], 40, 'RPM read every cycle'); }
  // 3) cheap clone (KONNWEI-style ELM v1.5): misses the first ATZ, rejects ATAT2 and the count digit — everything still works
  { const f = new FakeElm({ digit: false, atat2: false, zFail: 1, eqr: true }), e = new Elm327(f); await e.init();
    assert.strictEqual(e.useCnt, false); assert.strictEqual(e.tuned, false); assert.strictEqual(e.single, false);
    let d; for (let i = 0; i < 30; i++) d = await e.readLive();
    assert(d.RPM > 600 && Math.abs(d.LAMB - 0.98) < 0.05, 'clone: AFR lambda ' + d.LAMB); assert(d.EQR > 0.9 && d.EQR < 1.1, 'clone: EQR'); }
  // 4) adapter that stops understanding the digit in the middle of a session: driver drops it and carries on
  { const f = new FakeElm({}), e = new Elm327(f); await e.init(); assert.strictEqual(e.useCnt, true);
    f.digit = false; let d; for (let i = 0; i < 4; i++) d = await e.readLive();
    assert.strictEqual(e.useCnt, false, 'digit dropped'); assert(d.RPM > 600 && d.ECT === 90, 'still reading after fallback'); }
  // 5) one value per request (ISO/KWP cars): ≤ 5 requests per cycle, RPM + AFR every cycle, every other value still comes round
  { const f = new FakeElm({ noMulti: true, eqr: true, lambda: false }), e = new Elm327(f); await e.init(); assert.strictEqual(e.single, true);
    f.pidCount = {}; const n0 = f.nreq, N = 60; for (let i = 0; i < N; i++) await e.readLive();
    assert((f.nreq - n0) / N <= 5.1, 'single-PID requests per cycle ' + (f.nreq - n0) / N);
    assert.strictEqual(f.pidCount[0x0C], N, 'RPM every cycle'); assert.strictEqual(f.pidCount[0x44], N, 'AFR (PID 44) every cycle');
    for (const p of e.pidList) assert(f.pidCount[p] >= 1, 'PID ' + p.toString(16) + ' never read'); }
  // 6) HONDA-KLINE bridge (own firmware): no count digit, no timing changes
  { const f = new FakeElm({ honda: true, digit: false }), e = new Elm327(f); await e.init();
    assert.strictEqual(e.useCnt, false); assert.strictEqual(e.tuned, false); let d; for (let i = 0; i < 12; i++) d = await e.readLive(); assert(d.RPM > 600 && Math.abs(d.INJ - 6) < 0.01); }
  console.log('v1.5.1 elm tests passed (multi-frame, count digit, clone adapter, fallback, rotating queue)');
})().catch((x) => { console.error(x); process.exit(1); });

// ---- v1.5.3: init tolerant of cheap clones (blue ELM327 MINI, KONNWEI KW90x): protocol ladder, readable errors ----
(async () => {
  const { Elm327, FakeElm } = require('../src/elm.js');
  // car that only answers on ISO 9141-2 (protocol 3): the adapter's automatic search gives up, the ladder finds it
  { const logs = [], f = new FakeElm({ needSp: 3, noMulti: true, eqr: true }), e = new Elm327(f, { log: (k, m) => logs.push(m) }); await e.init();
    assert.strictEqual(e.proto, '3', 'proto ' + e.proto); assert.strictEqual(e.single, true);
    assert(logs.some((m) => /ลองโปรโตคอล 3/.test(m)), 'ladder progress is logged'); let d; for (let i = 0; i < 12; i++) d = await e.readLive(); assert(d.RPM > 600, 'reads after ladder');
    assert(logs.some((m) => /อแดปเตอร์ ELM327 v1.5 · โปรโตคอล 3/.test(m)), 'handshake summary logged: ' + logs.join(' / ')); }
  // nothing answers on any protocol: the error carries what the adapter really said
  { const f = new FakeElm({ needSp: 'Z' }), e = new Elm327(f); let msg = '';
    try { await e.init(); } catch (x) { msg = x.message; }
    assert(/ไม่เจอ ECU/.test(msg) && /UNABLE TO CONNECT/.test(msg), 'error text: ' + msg); assert.strictEqual(e.state, 'NOECU'); }
  // normal car: no ladder, init does not get slow (gaps between AT commands are short)
  { const logs = [], t0 = Date.now(), e = new Elm327(new FakeElm({}), { log: (k, m) => logs.push(m) }); await e.init();
    assert(!logs.some((m) => /ลองโปรโตคอล/.test(m)), 'no ladder on a normal car'); assert(Date.now() - t0 < 2500, 'init time ' + (Date.now() - t0)); }
  console.log('v1.5.3 elm tests passed (protocol ladder, readable error, no slowdown)');
})().catch((x) => { console.error(x); process.exit(1); });

// ---- v1.5.3: AFR from the narrowband O2 sensor, gentle modes for fragile adapters, silent-adapter detection ----
(async () => {
  const P = require('../src/proto.js'), { Elm327, FakeElm } = require('../src/elm.js');
  const near = (a, b, m) => assert(Math.abs(a - b) < 0.01, m + ': ' + a + ' vs ' + b);
  // 1) voltage → AFR table (petrol) and the fuel scaling; out of range clamps; garbage is rejected
  near(P.o2ToAfr(0.1), 17.0, '0.1 V'); near(P.o2ToAfr(0.2), 15.5, '0.2 V'); near(P.o2ToAfr(0.45), 14.7, '0.45 V'); near(P.o2ToAfr(0.8), 13.5, '0.8 V'); near(P.o2ToAfr(0.9), 12.0, '0.9 V');
  near(P.o2ToAfr(0.625), 14.1, 'interpolated (0.625 V)'); near(P.o2ToAfr(0.0), 17.0, 'clamp lean'); near(P.o2ToAfr(1.2), 12.0, 'clamp rich'); near(P.o2ToAfr(0.45, 9.0), 14.7 * 9.0 / 14.7, 'ethanol scaling');
  assert.strictEqual(P.o2ToAfr(NaN), null);
  // 2) a car with only a narrowband sensor offers AFR; diesel does not; PID 14 is read every cycle for it
  { const f = new FakeElm({ o2V: 0.8, lambda: false }), e = new Elm327(f); await e.init();
    assert(e.channelKeys().has('AFR') && e.channelKeys().has('O2') && !e.channelKeys().has('EQR'), 'AFR offered from O2');
    f.pidCount = {}; let d; for (let i = 0; i < 20; i++) d = await e.readLive(); near(d.O2, 0.8, 'O2 volts'); assert.strictEqual(f.pidCount[0x14], 20, 'O2 read every cycle'); }
  { const f = new FakeElm({ o2V: 0.8, lambda: false, diesel: true }), e = new Elm327(f); await e.init(); assert(!e.channelKeys().has('AFR'), 'diesel: no AFR from a narrowband sensor'); }
  // 3) one value per request: the chosen source gets the every-cycle slot (auto → O2 when there is no wideband, forced "cmd" → PID 44)
  for (const [pref, pid] of [['auto', 0x14], ['cmd', 0x44], ['o2', 0x14]]) {
    const f = new FakeElm({ noMulti: true, o2V: 0.45, lambda: false, eqr: true }), e = new Elm327(f, {}); e.afrPref = pref; await e.init(); e.afrPref = pref; f.pidCount = {};
    for (let i = 0; i < 24; i++) await e.readLive(); assert.strictEqual(f.pidCount[pid], 24, 'pref ' + pref + ' reads PID ' + pid.toString(16) + ' every cycle'); }
  // 4) gentle modes after link drops: 1 = no count digit / AT2, 2 = one value per request, pauses between requests
  { const f = new FakeElm({}), e = new Elm327(f, { safe: 1 }); await e.init(); assert.strictEqual(e.useCnt, false); assert.strictEqual(e.tuned, false); assert.strictEqual(e.single, false); }
  { const f = new FakeElm({}), e = new Elm327(f, { safe: 2 }); await e.init(); assert.strictEqual(e.single, true); assert(e.gap >= 45, 'pause between requests');
    let d; for (let i = 0; i < 12; i++) d = await e.readLive(); assert(d.RPM > 600 && d.ECT === 90, 'gentlest mode still reads'); }
  // 5) adapter that stops answering (link up, nobody home): no old numbers passed off as live, alive() tells adapter from car
  { const f = new FakeElm({}), e = new Elm327(f, { deadMs: 400 }); await e.init(); e.liveTO = 100; assert(await e.readLive(), 'live before');
    f.mute(true); let d = 1, n = 0; const t0 = Date.now(); while (d && n++ < 60) d = await e.readLive();
    assert.strictEqual(d, null, 'null once nothing fresh arrives'); assert(Date.now() - t0 < 3000, 'detected within ' + (Date.now() - t0) + ' ms');
    assert.strictEqual(await e.alive(), false, 'muted adapter is not alive'); f.mute(false); assert.strictEqual(await e.alive(), true); assert(await e.readLive(), 'recovers when it answers again'); }
  // 6) the reason a link ended is handed on
  { const f = new FakeElm({}), e = new Elm327(f); await e.init(); let why = null; e.onLost = (w) => { why = w; }; f.lose('อแดปเตอร์ปิดการเชื่อมต่อเอง'); assert.strictEqual(why, 'อแดปเตอร์ปิดการเชื่อมต่อเอง'); assert.strictEqual(e.state, 'OFF'); }
  console.log('v1.5.3 tests passed (O2 → AFR, source choice, gentle modes, silent adapter, loss reason)');
})().catch((x) => { console.error(x); process.exit(1); });

// ---- v1.5.3 (from the JetSmartGaugeCAR ideas): remembered protocol, PIDs that never answer sit out, combined requests give way, "not available" answers are dropped ----
(async () => {
  const { Elm327, FakeElm } = require('../src/elm.js');
  // 1) remembered protocol: connects straight away, no search ladder; a wrong memory falls back to the normal search
  { const logs = [], f = new FakeElm({ needSp: 3, noMulti: true, eqr: true }), e = new Elm327(f, { lastProto: '3', log: (k, m) => logs.push(m) }); await e.init();
    assert.strictEqual(e.proto, '3'); assert(!logs.some((m) => /ลองโปรโตคอล/.test(m) || /จำไว้/.test(m)), 'no search needed: ' + logs.join(' / ')); assert(!f.sent.includes('ATSP0'), 'automatic search not started'); }
  { const logs = [], f = new FakeElm({ needSp: 3, noMulti: true, eqr: true }), e = new Elm327(f, { lastProto: '6', log: (k, m) => logs.push(m) }); await e.init();
    assert.strictEqual(e.proto, '3'); assert(logs.some((m) => /จำไว้ \(6\)/.test(m)), 'stale memory is reported'); let d; for (let i = 0; i < 12; i++) d = await e.readLive(); assert(d.RPM > 600); }
  // 2) slow K-line ECUs get the longer wait (ATST64); CAN keeps the short one
  { const f = new FakeElm({ needSp: 3, noMulti: true, eqr: true }), e = new Elm327(f); await e.init(); assert(f.sent.includes('ATST64'), 'K-line: ATST64'); assert.strictEqual(e.liveTO, 1500); }
  { const f = new FakeElm({}), e = new Elm327(f); await e.init(); assert(!f.sent.includes('ATST64')); assert.strictEqual(e.liveTO, 800, 'CAN: short wait'); }
  // 3) a PID the car never answers (MAP here) stops costing a slot every cycle; everything else keeps coming; the PID is retried now and then
  { const f = new FakeElm({ deaf: [0x0B] }), e = new Elm327(f); await e.init(); f.pidCount = {}; let d; const N = 90; for (let i = 0; i < N; i++) d = await e.readLive();
    assert(f.pidCount[0x0B] <= 12, 'deaf PID asked ' + f.pidCount[0x0B] + ' of ' + N + ' cycles'); assert(f.pidCount[0x0B] >= 2, 'but still retried now and then');
    assert(d.RPM > 600 && d.ECT === 90 && d.SPD === 62, 'other values unaffected'); assert.strictEqual(d.MAP, undefined, 'no MAP value invented');
    f.deaf.clear(); for (let i = 0; i < 80; i++) d = await e.readLive(); assert.strictEqual(d.MAP, 50, 'recovers when the car answers again'); }
  // 4) a car that answers only part of every combined request: after 6 short answers it goes to one value per request and every value comes back
  { const f = new FakeElm({ partial: 2 }), e = new Elm327(f); await e.init(); let d; for (let i = 0; i < 40; i++) d = await e.readLive();
    assert.strictEqual(e.single, true, 'switched to single requests'); for (let i = 0; i < 60; i++) d = await e.readLive();
    assert(d.RPM > 600 && d.ECT === 90 && d.SPD === 62 && d.MAP === 50, 'all values read in single mode: ' + JSON.stringify(d)); }
  // 5) "not available" answers (all ones) never reach the screen as numbers
  { const f = new FakeElm({ junk: [0x0C], eqr: true }), e = new Elm327(f); await e.init(); let d; for (let i = 0; i < 12; i++) d = await e.readLive();
    assert.strictEqual(d.RPM, undefined, 'FFFF rpm dropped: ' + d.RPM); assert.strictEqual(d.SPD, 62); }
  { const f = new FakeElm({ junk: [0x44], eqr: true, lambda: false }), e = new Elm327(f); await e.init(); let d; for (let i = 0; i < 12; i++) d = await e.readLive();
    assert.strictEqual(d.EQR, undefined, 'lambda 1.99997 dropped: ' + d.EQR); }
  // 6) a pending request ends at once when the link is lost (no waiting for the timeout)
  { const f = new FakeElm({}), e = new Elm327(f); await e.init(); f.mute(true); const t0 = Date.now(); const p = e.query('0100', 5000); setTimeout(() => f.lose('ขาด'), 50); await p; assert(Date.now() - t0 < 1000, 'ended in ' + (Date.now() - t0) + ' ms'); }
  console.log('v1.5.3 tests passed (remembered protocol, ATST64, deaf PIDs skipped, combined→single, junk answers dropped, instant link-loss)');
})().catch((x) => { console.error(x); process.exit(1); });

// ---- v1.5.6: reading / clearing trouble codes ----
(async () => {
  const { Elm327, FakeElm } = require('../src/elm.js');
  const mk = async (o) => { const f = new FakeElm(o), e = new Elm327(f); await e.init(); return { f, e }; };
  // 1) CAN answer padded to 7 data bytes ("43 01 01 18 00 00 00") used to read as P0101 + P1800; the count byte decides now
  { const { e } = await mk({ dtc: 'pad' }); const d = await e.readDTC(); assert.deepStrictEqual(d.current, ['P0118'], 'padded frame: ' + d.current); }
  // 2) several codes arrive as a multi-frame answer (byte-count line + "0:" "1:" lines) — they used to be dropped
  { const { e } = await mk({ dtc: 'many' }); const d = await e.readDTC(); assert.deepStrictEqual(d.current, ['P0118', 'P0301', 'P0420', 'P0500'], 'multi-frame: ' + d.current); }
  // 3) plain single frame as before; raw answers are kept for the log
  { const { e } = await mk({}); const d = await e.readDTC(); assert.deepStrictEqual(d.current, ['P0301', 'P0420']); assert(/43 02 03 01 04 20/.test(e.dtcRaw['03']), 'raw kept: ' + JSON.stringify(e.dtcRaw)); }
  // 4) clearing works with long timing and the quick timing comes back afterwards
  { const { f, e } = await mk({}); f.sent.length = 0; assert.strictEqual(await e.clearDTC(), true); assert.strictEqual(e.clearInfo.ok, true);
    const i4 = f.sent.indexOf('04'), iFF = f.sent.indexOf('ATSTFF'); assert(iFF >= 0 && iFF < i4, 'long timeout set before the clear command');
    assert.strictEqual(f.sent[f.sent.length - 1], e.tuned ? 'ATST19' : 'ATST32', 'timing restored: ' + f.sent.slice(-3)); assert.deepStrictEqual((await e.readDTC()).current, []); }
  // 5) the reason is given when the ECU says no
  { const { e } = await mk({ clear04: '7F 04 22' }); assert.strictEqual(await e.clearDTC(), false); assert(/ดับเครื่อง/.test(e.clearInfo.why), e.clearInfo.why); }
  { const { e } = await mk({ clear04: 'NO DATA' }); assert.strictEqual(await e.clearDTC(), false); assert(/ไม่ตอบ/.test(e.clearInfo.why), e.clearInfo.why); }
  { const { e } = await mk({ clear04: '7F 04 11' }); assert.strictEqual(await e.clearDTC(), false); assert(/ไม่รองรับ/.test(e.clearInfo.why), e.clearInfo.why); }
  // 6) a fault that is still there: the ECU confirms the clear, the code is back at the next read (the app tells the user so)
  { const { e } = await mk({ dtc: 'sticky' }); assert.strictEqual(await e.clearDTC(), true); assert.deepStrictEqual((await e.readDTC()).current, ['P0118']); }
  // 7) K-line cars keep their own default timing after a code operation
  { const f = new FakeElm({ needSp: 3, noMulti: true, eqr: true }), e = new Elm327(f); await e.init(); f.sent.length = 0; await e.readDTC(); assert.strictEqual(f.sent[f.sent.length - 1], 'ATST64', 'K-line ST restored: ' + f.sent.slice(-3)); }
  console.log('v1.5.6 tests passed (DTC: padded / multi-frame / count byte, clear with long timeout, reasons, sticky fault)');
})().catch((x) => { console.error(x); process.exit(1); });

// ---- v1.5.9: Honda bridge — fast values every cycle; several values per request when the firmware allows it ----
(async () => {
  const assert = require('assert'), { Elm327, FakeElm } = require('../src/elm.js');
  // 1) bridge that answers one value per request (current firmware): RPM and throttle in EVERY cycle, speed every 2nd, the rest rotates; a cycle is 4 requests
  { const f = new FakeElm({ honda: true, latency: 1 }), e = new Elm327(f); await e.init();
    assert.strictEqual(e.honda, true); assert.strictEqual(e.hondaMulti, false, 'old bridge: no combined requests'); assert.strictEqual(e.single, true);
    f.pidCount = {}; const n0 = f.nreq, N = 40; let d; for (let i = 0; i < N; i++) d = await e.readLive();
    for (const p of [0x0C, 0x11]) assert.strictEqual(f.pidCount[p], N, 'PID ' + p.toString(16) + ' read every cycle (' + f.pidCount[p] + ')');
    assert(f.pidCount[0x0D] >= N / 2 - 1, 'speed every 2nd cycle (' + f.pidCount[0x0D] + ')');
    const per = (f.nreq - n0) / N; assert(per >= 3.5 && per <= 4.3, 'requests per cycle ' + per);
    assert(d.RPM > 600 && d.TPS > 10 && d.SPD === 62, 'live ' + JSON.stringify(d));
    for (const p of [0x0B, 0x05, 0x0F, 0xD1]) assert(f.pidCount[p] >= 3, 'rotating value ' + p.toString(16) + ' still comes round (' + f.pidCount[p] + ')'); }
  // 2) bridge with the multi-value firmware: found by the probe, the whole cycle takes 2 requests or fewer, every value every cycle
  { const f = new FakeElm({ honda: true, hmulti: true, latency: 1 }), e = new Elm327(f); await e.init();
    assert.strictEqual(e.hondaMulti, true, 'combined requests detected'); assert.strictEqual(e.single, false);
    f.pidCount = {}; const n0 = f.nreq, N = 30; let d; for (let i = 0; i < N; i++) d = await e.readLive();
    const per = (f.nreq - n0) / N; assert(per <= 1.8, 'requests per cycle with multi ' + per);
    for (const p of [0x0C, 0x11, 0x0B, 0x0D]) assert(f.pidCount[p] >= N - 1, 'fast PID ' + p.toString(16) + ' every cycle (' + f.pidCount[p] + ')');
    for (const p of [0x05, 0x0F, 0x42]) assert(f.pidCount[p] >= N / 4, 'slow PID ' + p.toString(16) + ' still comes round (' + f.pidCount[p] + ')');
    assert.strictEqual(e.single, false, 'stays in combined mode'); assert(d.RPM > 600 && d.TPS > 10 && d.SPD === 62 && d.ECT === 90, 'live ' + JSON.stringify(d)); }
  console.log('v1.5.9 tests passed (Honda bridge: fast values every cycle, combined requests detected)');
  // 3) CAN adapter (v1.5.10): a fast cycle is ONE request with RPM / speed / throttle / MAP / lambda; the slow values ride in a second request every 2nd-4th cycle
  { const f = new FakeElm({ latency: 1 }), e = new Elm327(f); await e.init(); assert.strictEqual(e.single, false);
    f.pidCount = {}; const n0 = f.nreq, N = 60; let d; for (let i = 0; i < N; i++) d = await e.readLive();
    const per = (f.nreq - n0) / N; assert(per >= 1.2 && per <= 1.8, 'requests per cycle (CAN) ' + per);
    for (const p of [0x0C, 0x0D, 0x11, 0x0B, 0x34]) assert(f.pidCount[p] >= N - 1, 'fast PID ' + p.toString(16) + ' every cycle (' + f.pidCount[p] + ')');
    for (const p of [0x05, 0x0F, 0x42, 0x5C]) assert(f.pidCount[p] >= N / 5, 'slow PID ' + p.toString(16) + ' still comes round (' + f.pidCount[p] + ')');
    assert(d.RPM > 600 && d.ECT === 90 && d.SPD === 62 && d.TPS > 10 && Math.abs(d.LAMB - 0.98) < 0.05 && d.BATT > 13, 'live ' + JSON.stringify(d)); }
  // 4) gentle mode keeps the old longer cycle (fragile adapters)
  { const f = new FakeElm({ latency: 1 }), e = new Elm327(f); e.safe = 1; await e.init();
    f.pidCount = {}; const n0 = f.nreq, N = 30; for (let i = 0; i < N; i++) await e.readLive();
    const per = (f.nreq - n0) / N; assert(per >= 1.8, 'gentle mode keeps 2+ requests per cycle (' + per + ')'); }
  console.log('v1.5.10 tests passed (CAN: one fast request per cycle, slow values ride along, gentle mode unchanged)');

})().catch((e) => { console.error(e); process.exit(1); });
