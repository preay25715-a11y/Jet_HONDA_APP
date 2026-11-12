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
  console.log('\nALL TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
