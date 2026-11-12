/* =====================================================================
 * Jet_HONDA Tune — sim.js
 * Virtual Keihin ECU used by DEMO mode and by the test-suite.
 * Speaks the same frames as a real ECU, including the full flash sequence.
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = (typeof module !== 'undefined' && module.exports) ? require('./proto.js') : root.HP;

  function makeImage(size) {
    const b = new Uint8Array(size);
    let s = 0x1234;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7FFFFFFF) >> 16) & 0xFF;
    for (let i = 0; i < size; i++) b[i] = i < size * 0.7 ? rnd() : 0xFF;
    // demo maps (same layout as DEMO_XDF below): RPM axis, TPS axis, fuel 29x25 (16-bit BE, X*0.001), ignition 29x25 (8-bit, X/2-10)
    const RPM = [840, 1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000, 2250, 2500, 2750, 3000, 3250, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 7750, 8000, 8500, 9000, 9500, 9800];
    const TPS = [0, 0.4, 0.8, 1.2, 1.9, 2.5, 3.0, 3.5, 4.0, 4.9, 5.9, 7.9, 9.9, 11.9, 13.9, 15.9, 18.6, 20.9, 26.4, 31.8, 39.5, 44.7, 50.0, 59.3, 72.0];
    const w16 = (o, v) => { if (o + 1 < size) { b[o] = (v >> 8) & 255; b[o + 1] = v & 255; } };
    RPM.forEach((v, i) => w16(0x3F00 + i * 2, v));
    TPS.forEach((v, i) => w16(0x3F80 + i * 2, Math.round(v * 10)));
    for (let r = 0; r < 29; r++) for (let c = 0; c < 25; c++) {
      const rn = r / 28, sT = Math.pow(TPS[c] / 72, 0.55);
      const lo = 4.72 - 2.6 * Math.sqrt(rn), hi = 9.9 + 1.5 * rn - 0.4 * rn * rn + Math.sin(r / 2.5) * 0.12;
      w16(0x4000 + (r * 25 + c) * 2, Math.round((lo * (1 - sT) + hi * sT) * 1000));
      const ign = 12 + rn * 22 - sT * 8 + Math.sin(c / 4) * 0.8;
      if (0x4600 + r * 25 + c < size) b[0x4600 + r * 25 + c] = Math.round((ign + 10) * 2);
    }
    b.set(Array.from('MFB-DEMO K03-H01').map((c) => c.charCodeAt(0)), 0x10);
    return P.binFixChecksum(b, 0);
  }

  class SimTransport {
    constructor(o) {
      o = o || {};
      this.name = 'DEMO'; this.fw = 'Jet_HONDA GAUGE (จำลอง)';
      this.kind = 'demo';
      this.latency = o.latency == null ? 2 : o.latency;
      this.size = (o.sizeKB || 64) * 1024;
      this.start = o.start == null ? 0x8000 : o.start;
      this.flash = makeImage(this.size);
      this.eeprom = new Uint8Array(256).map((_, i) => (i * 7) & 0xFF);
      this.mode = 'OK';           // OK | BOOT | RECOVER_OLD
      this.requirePw = !!o.requirePw;
      this.secure = false; this.arm = 0; this.bootArm = false;
      this.erase = 0; this.status = 0; this.dtc = ['7-1', '21-1']; this.past = ['8-2'];
      this.t0 = Date.now(); this.files = [];
      this.failNext = 0;
    }
    async open() { return true; }
    async close() {}
    async sense() { return true; }
    async wake() { await P.sleep(this.latency ? 20 : 0); }
    async sendFile(name, u8, onProg) {
      for (let i = 0; i < u8.length; i += 160) { await P.sleep(this.latency ? 4 : 0); onProg && onProg(Math.min(i + 160, u8.length), u8.length); }
      this.files.push({ name, size: u8.length, crc: P.crc32(u8) });
      return true;
    }
    async fileList() { return this.files.map((f) => ({ name: '/ecu/' + f.name + '.bin', size: f.size })); }
    async txrx(frame, ml) {
      if (this.latency) await P.sleep(this.latency); else await Promise.resolve();
      if (this.failNext > 0) { this.failNext--; return null; }
      if ((P.sum(frame) & 0xFF) !== 0) return null;
      const mt = frame.slice(0, ml), d = frame.slice(ml + 1, frame.length - 1);
      const R = (rt, data) => P.buildFrame(rt, data);
      const m0 = mt[0];
      if (ml === 1 && m0 === 0xFE) return this.mode === 'BOOT' ? null : R([0x0E], [0x72]);
      if (ml === 1 && m0 === 0x72) {
        if (this.mode !== 'OK') return null;
        const c = d[0];
        if (c === 0x00) { if (d[1] === 0xF1 && this.arm >= 2) this.bootArm = true; return R([0x02], [0x00]); }
        if (c === 0x71) return R([0x02], [0x71, d[1], ...this.table(d[1])]);
        if (c === 0x74 || c === 0x73) {
          const list = c === 0x74 ? this.dtc : this.past;
          const pairs = list.slice((d[1] - 1) * 3, d[1] * 3);
          if (!pairs.length) return R([0x02], [c, d[1], 0x00, 0, 0, 0, 0, 0, 0]);
          const b = [c, d[1], pairs.length];
          for (let k = 0; k < 3; k++) { const p = pairs[k]; if (p) { const [x, y] = p.split('-').map(Number); b.push(x, y); } else b.push(0, 0); }
          return R([0x02], b);
        }
        if (c === 0x60) { this.dtc = []; this.past = []; return R([0x02], [0x60, 0x03]); }
        return null;
      }
      if (ml === 1 && m0 === 0x27) {
        if (d[0] === 0xE0) { this.secure = true; return R([0x07], [0xE0, 0x00]); }
        if (d[0] === 0x00 && this.bootArm) { this.mode = 'BOOT'; this.status = 0; return R([0x07], [0x00, 0x01]); }
        return R([0x07], [d[0], 0x00]);
      }
      if (ml === 1 && m0 === 0x7D) {
        if (this.mode === 'BOOT') return null;
        if (d[1] === 0x02 && d[2] === 0x50) this.arm = 1;
        if (d[1] === 0x03 && d[2] === 0x2D && this.arm === 1) this.arm = 2;
        if (this.mode === 'RECOVER_OLD' && this.arm === 2) { this.mode = 'BOOT'; }
        return R([0x0D], [0x01, 0x00, 0x00, 0x12]);
      }
      if (ml === 1 && m0 === 0x7B) return null;
      if (ml === 3 && m0 === 0x82) {
        if (this.mode !== 'OK') return null;
        const rt = [0x92, 0x92, mt[2]];
        if (mt[2] === 0x00) {
          if (this.requirePw && !this.secure) return null;
          const a = (d[0] << 16) | (d[2] << 8) | d[1], n = d[3];
          const off = a - this.start;
          if (off < 0 || off + n > this.size || n < 1 || n > 12) return null;
          return R(rt, Array.from(this.flash.subarray(off, off + n)));
        }
        if (mt[2] === 0x10) { const w = d[0] & 0x7F; return R(rt, [this.eeprom[w * 2], this.eeprom[w * 2 + 1]]); }
        if (mt[2] === 0x14) { const w = d[0] & 0x7F; this.eeprom[w * 2] = d[1]; this.eeprom[w * 2 + 1] = d[2]; return R(rt, []); }
        if (mt[2] === 0x18 || mt[2] === 0x19) { this.eeprom.fill(mt[2] === 0x18 ? 0xFF : 0x00); return R(rt, []); }
        return null;
      }
      if (ml === 1 && m0 === 0x7E) {
        if (this.mode !== 'BOOT') return null;
        const c = d[1];
        if (c === 0x01) return R([0x0E], [0x01, this.status]);
        if (c === 0x04) { this.erase = 6; this.flash.fill(0xFF); return R([0x0E], [0x01, 0x00]); }
        if (c === 0x05) { if (this.erase > 0) this.erase--; return R([0x0E], [0x01, this.erase ? 0x01 : 0x00]); }
        if (c === 0x06) {
          const x = d.slice(2, d.length - 2), c1 = d[d.length - 2], c2 = d[d.length - 1];
          if (P.ck8(x) !== c1 || P.ckHonda(x) !== c2) return null;
          const addr = (x[0] << 8) | x[1], data = x.slice(2, x.length - 2);
          const off = addr * 16 - this.start;
          if (off < 0 || off + data.length > this.size) return null;
          this.flash.set(data, off);
          return R([0x0E], [0x01, 0x06, x[x.length - 2], x[x.length - 1]]);
        }
        if (c === 0x0C) { this.status = 0x0F; return R([0x0E], [0x01, 0x00]); }
        if (c === 0x0D) { this.mode = 'OK'; this.arm = 0; this.bootArm = false; return R([0x0E], [0x01, 0x0F]); }
        return R([0x0E], [0x01, 0x00]);
      }
      return null;
    }
    // demo ride: idle 4s → full throttle 14s → coast 8s (26s loop)
    dyn() {
      const s = (Date.now() - this.t0) / 1000, ph = s % 26;
      let spd, tps, rpm;
      if (ph < 4) { spd = 0; tps = 0; rpm = 1500 + Math.sin(s * 3) * 30; }
      else if (ph < 18) { const t = ph - 4; spd = 168 * (1 - Math.exp(-t / 6)); tps = 92 + Math.sin(s * 9) * 3; rpm = 4500 + ((spd * 97) % 5200); }
      else { const t = ph - 18, v0 = 168 * (1 - Math.exp(-14 / 6)); spd = Math.max(0, v0 * (1 - t / 7)); tps = 0; rpm = 1500 + spd * 30; }
      const wot = tps > 50;
      return { spd, tps, rpm: Math.round(Math.min(rpm, 10500)), map: wot ? 95 : 32, inj: wot ? 6.0 + Math.sin(s * 5) * 0.1 : 2.1, ign: wot ? 27.9 : 12,
        afr: wot ? 12.7 + Math.sin(s * 7) * 0.35 + (rpm > 8000 ? 0.6 : 0) : 14.6 + Math.sin(s * 2) * 0.4, eot: 78, o2: wot ? 0.81 : 0.45 + Math.sin(s * 4) * 0.35 };
    }
    // Smart-Gauge sensor block (AFR wideband + GPS) — same fields as LINK SENSORS
    async sensors() {
      if (this.latency) await P.sleep(this.latency);
      const d = this.dyn(), now = Date.now();
      if (this.gpsT) { const dt = (now - this.gpsT) / 1000; this.lat += (d.spd / 3.6) * dt / 111320; }
      else this.lat = 13.7563;
      this.gpsT = now;
      return { afr: +d.afr.toFixed(2), spd: +d.spd.toFixed(1), sats: 19, satsView: 26, fix: true, lat: this.lat, lon: 100.5018, eot: d.eot, o2: +d.o2.toFixed(2), afrOk: true, gpsOk: true, eotOk: true, o2Ok: true, t: now };
    }
    table(t) {
      if (t === 0x00) return [0x4B, 0x30, 0x33, 0x48, 0x01, 0x10, 0x22];  // "K03H"..
      if (t === 0x11) {
        const d = this.dyn();
        const inj = Math.round(d.inj * 250);
        return [d.rpm >> 8, d.rpm & 255, Math.round((0.5 + d.tps / 100 * 4) * 51.2), Math.round(d.tps * 1.6),
          120, 79 + 40, 150, 34 + 40, 140, d.map, 0, 0, 141, Math.round(d.spd), inj >> 8, inj & 255, Math.round((d.ign + 64) * 2), 0, 0, 0];
      }
      if (t === 0x17) return [0x00, 0x51, 0x00, 0x00];
      if (t === 0xD1) return [0x01, 0x00, 0x00, 0x00, 0x00];
      if (t === 0x10 || t === 0x20) return [0x00, 0x00, 0x00];
      return [];
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { SimTransport, makeImage };
  else root.SimTransport = SimTransport;
})(typeof window !== 'undefined' ? window : globalThis);
