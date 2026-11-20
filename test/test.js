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
