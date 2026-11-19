/* =====================================================================
 * Jet Smart Gauge — elm.js
 * ELM327 / OBD-II driver (Bluetooth Classic SPP or BLE UART — any ELM327 clone).
 *   stream: { write(bytes), onData(u8) , close() }
 * Acts as both the "transport" (kind 'obd') and the "ecu" object used by the app:
 *   readLive() -> {RPM,SPD,TPS,ECT,IAT,MAP,BATT,IGN,...OBD keys}, readDTC(), clearDTC()
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = (typeof module !== 'undefined' && module.exports) ? require('./proto.js') : root.HP;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const A = (b) => b[0], B = (b) => b[1], C = (b) => b[2], D = (b) => b[3];
  const u16 = (b) => b[0] * 256 + b[1];
  const s16 = (b) => { const v = u16(b); return v > 32767 ? v - 65536 : v; };
  // pid -> [key, byteCount, decoder]. keys not in the core set map to P.OBD keys.
  const PIDS = {
    0x04: ['LOAD', 1, (b) => A(b) * 100 / 255], 0x05: ['ECT', 1, (b) => A(b) - 40], 0x06: ['STFT1', 1, (b) => A(b) * 100 / 128 - 100],
    0x07: ['LTFT1', 1, (b) => A(b) * 100 / 128 - 100], 0x08: ['STFT2', 1, (b) => A(b) * 100 / 128 - 100], 0x09: ['LTFT2', 1, (b) => A(b) * 100 / 128 - 100],
    0x0A: ['FP', 1, (b) => A(b) * 3], 0x0B: ['MAP', 1, A], 0x0C: ['RPM', 2, (b) => u16(b) / 4], 0x0D: ['SPD', 1, A], 0x0E: ['IGN', 1, (b) => A(b) / 2 - 64],
    0x0F: ['IAT', 1, (b) => A(b) - 40], 0x10: ['MAF', 2, (b) => u16(b) / 100], 0x11: ['TPS', 1, (b) => A(b) * 100 / 255],
    0x1F: ['RUNT', 2, u16], 0x21: ['MILD', 2, u16], 0x22: ['FRPR', 2, (b) => u16(b) * 0.079], 0x23: ['FRP', 2, (b) => u16(b) * 10],
    0x2C: ['EGRC', 1, (b) => A(b) * 100 / 255], 0x2D: ['EGRE', 1, (b) => A(b) * 100 / 128 - 100], 0x2E: ['EVAPC', 1, (b) => A(b) * 100 / 255],
    0x2F: ['FUELL', 1, (b) => A(b) * 100 / 255], 0x30: ['WARM', 1, A], 0x31: ['DISTC', 2, u16], 0x32: ['EVAPP', 2, (b) => s16(b) / 4],
    0x33: ['BARO', 1, A], 0x34: ['LAMB', 4, (b) => u16(b) * 2 / 65536],
    0x3C: ['CAT11', 2, (b) => u16(b) / 10 - 40], 0x3D: ['CAT21', 2, (b) => u16(b) / 10 - 40], 0x3E: ['CAT12', 2, (b) => u16(b) / 10 - 40], 0x3F: ['CAT22', 2, (b) => u16(b) / 10 - 40],
    0x42: ['BATT', 2, (b) => u16(b) / 1000], 0x43: ['ABSL', 2, (b) => u16(b) * 100 / 255], 0x44: ['EQR', 2, (b) => u16(b) * 2 / 65536],
    0x45: ['TPSR', 1, (b) => A(b) * 100 / 255], 0x46: ['AMB', 1, (b) => A(b) - 40], 0x47: ['TPSB', 1, (b) => A(b) * 100 / 255],
    0x49: ['APPD', 1, (b) => A(b) * 100 / 255], 0x4A: ['APPE', 1, (b) => A(b) * 100 / 255], 0x4C: ['CMDT', 1, (b) => A(b) * 100 / 255],
    0x4D: ['MILT', 2, u16], 0x4E: ['CLRT', 2, u16], 0x52: ['ETH', 1, (b) => A(b) * 100 / 255], 0x5C: ['EOT', 1, (b) => A(b) - 40],
    0x5D: ['INJT', 2, (b) => u16(b) / 128 - 210], 0x5E: ['FRATE', 2, (b) => u16(b) * 0.05],
    0x61: ['TQD', 1, (b) => A(b) - 125], 0x62: ['TQA', 1, (b) => A(b) - 125], 0x63: ['TQR', 2, u16],
    0x6F: ['BOOST', 1, (b) => B(b) * 2], 0x70: ['BOOST', 9, (b) => u16(b.slice(1, 3)) / 8], 0x73: ['EXHP', 5, (b) => u16(b.slice(1, 3)) / 10],
    0x74: ['TURBO', 5, (b) => u16(b.slice(1, 3)) * 10], 0x78: ['EGT1', 9, (b) => u16(b.slice(1, 3)) / 10 - 40], 0x79: ['EGT2', 9, (b) => u16(b.slice(1, 3)) / 10 - 40],
    0x7A: ['DPFD', 7, (b) => s16(b.slice(1, 3)) / 100], 0x7C: ['DPFT', 9, (b) => u16(b.slice(1, 3)) / 10 - 40],
    0x77: ['CACT', 5, (b) => B(b) - 40], 0x6B: ['EXHP', 5, (b) => u16(b.slice(1, 3)) / 10], 0x7F: ['RUNT', 13, (b) => (b[1] << 24 | b[2] << 16 | b[3] << 8 | b[4]) >>> 0],
    0x83: ['NOX', 5, (b) => u16(b.slice(1, 3))], 0x85: ['NOX', 9, (b) => u16(b.slice(1, 3))],
  };
  // polled every cycle (fast) vs. every Nth cycle (slow)
  const FAST = ['RPM', 'SPD', 'TPS', 'MAP', 'ECT', 'IAT', 'LOAD', 'IGN', 'MAF', 'BOOST'];
  const MAX_PER_REQ = 6;

  class Elm327 {
    constructor(stream, o) {
      o = o || {};
      this.kind = 'obd'; this.name = o.name || 'ELM327'; this.via = 'bt'; this.s = stream; this.state = 'OFF';
      this.buf = ''; this.waiter = null; this.supported = new Set(); this.cycle = 0; this.last = {}; this.log = o.log || (() => {});
      this.fuel = 'g'; this.proto = ''; this.ver = ''; this.stats = { tx: 0, rx: 0, retry: 0, bad: 0 };
      stream.onData = (u) => this._rx(u);
      stream.onLost = () => { this.state = 'OFF'; if (this.onLost) this.onLost(); };
    }
    _rx(u) {
      for (let i = 0; i < u.length; i++) this.buf += String.fromCharCode(u[i]);
      if (this.buf.indexOf('>') >= 0 && this.waiter) { const w = this.waiter; this.waiter = null; const t = this.buf; this.buf = ''; w(t); }
    }
    /** send an AT/OBD command, resolve with cleaned lines (prompt '>' ends the answer) */
    async query(cmd, timeout) {
      const tm = timeout || 2500;
      this.buf = '';
      const p = new Promise((res) => { this.waiter = res; setTimeout(() => { if (this.waiter === res) { this.waiter = null; const t = this.buf; this.buf = ''; res(t.indexOf('>') >= 0 ? t : null); } }, tm); });
      this.stats.tx++;
      await this.s.write(Array.from(cmd + '\r', (c) => c.charCodeAt(0)));
      const raw = await p;
      if (raw == null) { this.stats.bad++; return null; }
      this.stats.rx++;
      return raw.replace(/>/g, '').split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l && l.toUpperCase() !== cmd.toUpperCase());
    }
    async init() {
      this.state = 'INIT';
      let r = await this.query('ATZ', 4000);
      if (!r) { r = await this.query('ATI', 3000); if (!r) throw new Error('ELM327 ไม่ตอบ — ตรวจว่าเสียบที่รถและจับคู่ Bluetooth แล้ว (PIN 1234 / 0000)'); }
      this.ver = (r.find((l) => /ELM|OBD|v\d/i.test(l)) || '').replace(/[^\x20-\x7e]/g, '');
      for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATST32']) await this.query(c, 1500);
      let ok = false;
      // auto protocol; first 0100 can be slow (SEARCHING…, bus init)
      await this.query('ATSP0', 1500);
      for (let i = 0; i < 3 && !ok; i++) {
        const l = await this.query('0100', 12000);
        if (l && l.some((x) => /41\s?00/.test(x.replace(/\s/g, '').replace(/^SEARCHING\.\.\./, '')))) ok = true;
        else if (l && l.some((x) => /UNABLE|ERROR|NO DATA|CAN ERROR|BUS/i.test(x))) await sleep(500);
      }
      if (!ok) { this.state = 'NOECU'; throw new Error('ต่อ ELM327 ได้ แต่ไม่เจอ ECU — เปิดสวิตช์กุญแจ (ON) แล้วลองใหม่'); }
      const pr = await this.query('ATDPN', 1500); this.proto = pr ? pr.join('').replace(/^A/, '') : '';
      await this._scan();
      this.state = 'OK';
      return true;
    }
    _hexBytes(lines, mode, pid) {
      // join all lines; with ATH0/ATS0 each ECU's reply is "41 0C 1A F8". use the first one that matches
      const head = (mode + 0x40).toString(16).toUpperCase().padStart(2, '0') + (pid == null ? '' : pid.toString(16).toUpperCase().padStart(2, '0'));
      const out = [];
      for (const l of lines) {
        const h = l.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
        if (!/^[0-9A-F]+$/.test(h)) continue;
        const i = h.indexOf(head);
        if (i < 0) continue;
        const bytes = h.slice(i + head.length).match(/../g) || [];
        out.push(bytes.map((x) => parseInt(x, 16)));
      }
      return out;
    }
    async _scan() {
      this.supported = new Set();
      let base = 0;
      for (let k = 0; k < 8; k++) {
        const pid = k * 0x20;
        const l = await this.query('01' + pid.toString(16).toUpperCase().padStart(2, '0'), 3000);
        if (!l) break;
        const r = this._hexBytes(l, 1, pid)[0];
        if (!r || r.length < 4) break;
        const m = (r[0] << 24 | r[1] << 16 | r[2] << 8 | r[3]) >>> 0;
        for (let i = 0; i < 32; i++) if (m & (1 << (31 - i))) this.supported.add(pid + i + 1);
        if (!(m & 1)) break;
      }
      // fuel type (PID 51): 4 = diesel
      if (this.supported.has(0x51)) { const l = await this.query('0151', 1500); const r = l && this._hexBytes(l, 1, 0x51)[0]; if (r && r.length) this.fuel = r[0] === 4 ? 'd' : 'g'; }
      else this.fuel = [0x70, 0x23, 0x78, 0x7C, 0x83].some((p) => this.supported.has(p)) && !this.supported.has(0x0E) ? 'd' : 'g';
      this.pidList = Array.from(this.supported).filter((p) => PIDS[p]).sort((a, b) => a - b);
      this.log('info', 'OBD-II: รองรับ ' + this.pidList.length + ' ค่า · ' + (this.fuel === 'd' ? 'ดีเซล' : 'เบนซิน') + (this.proto ? ' · โปรโตคอล ' + this.proto : ''));
    }
    async _read(pids) {
      const out = {};
      const cmd = '01' + pids.map((p) => p.toString(16).toUpperCase().padStart(2, '0')).join('') ;
      const l = await this.query(cmd, 2500);
      if (!l) return out;
      // multiple PIDs in one answer: "41 0C xx xx 0D yy" (single-ECU) — walk the byte stream
      for (const ln of l) {
        const h = ln.replace(/[^0-9A-Fa-f]/g, '');
        if (!/^41/i.test(h)) continue;
        const by = (h.slice(2).match(/../g) || []).map((x) => parseInt(x, 16));
        let i = 0;
        while (i < by.length) {
          const pid = by[i], e = PIDS[pid];
          if (!e) break;
          const data = by.slice(i + 1, i + 1 + e[1]);
          if (data.length < e[1]) break;
          const v = e[2](data); if (isFinite(v)) out[e[0]] = v;
          i += 1 + e[1];
        }
      }
      return out;
    }
    async readLive() {
      if (this.state !== 'OK') return null;
      // tier 1 (every cycle): RPM / speed / throttle / MAP — one short request = fastest refresh
      // tier 2 (every 3rd cycle): the other Dash values;  tier 3 (every 12th): everything else
      const c = this.cycle++, key = (p) => PIDS[p][0];
      const T1 = ['RPM', 'SPD', 'TPS', 'MAP'];
      const t1 = this.pidList.filter((p) => T1.includes(key(p))), rest = this.pidList.filter((p) => !T1.includes(key(p)));
      const want = t1.slice();
      for (const p of rest) { const k = key(p); if (FAST.includes(k) ? c % 3 === 0 : c % 12 === 0) want.push(p); }
      if (!want.length) return null;
      const d = Object.assign({}, this.last);
      for (let i = 0; i < want.length; i += MAX_PER_REQ) {
        const g = want.slice(i, i + MAX_PER_REQ);
        let r = await this._read(g);
        if (!Object.keys(r).length && g.length > 1) { r = {}; for (const p of g) Object.assign(r, await this._read([p])); }
        Object.assign(d, r);
      }
      if (c % 12 === 0 && !this.supported.has(0x42)) { const l = await this.query('ATRV', 1500); const m = l && /([0-9.]+)\s*V/i.exec(l.join(' ')); if (m) d.BATT = parseFloat(m[1]); }
      this.last = d;
      return Object.assign({}, d);   // OBD keys (P.OBD) feed Dash/Grid directly
    }
    async readDTC() {
      const dec = (by) => { const o = []; for (let i = 0; i + 1 < by.length; i += 2) { const a = by[i], b = by[i + 1]; if (!a && !b) continue; o.push('PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16).toUpperCase() + (b >> 4).toString(16).toUpperCase() + (b & 15).toString(16).toUpperCase()); } return o; };
      const get = async (cmd, mode) => {
        const l = await this.query(cmd, 5000); if (!l) return [];
        const codes = [];
        for (const ln of l) {
          const h = ln.replace(/[^0-9A-Fa-f]/g, '').toUpperCase(); if (!h.startsWith(mode)) continue;
          let by = (h.slice(2).match(/../g) || []).map((x) => parseInt(x, 16));
          if (by.length % 2) by = by.slice(1);               // CAN: leading count byte
          codes.push(...dec(by));
        }
        return Array.from(new Set(codes));
      };
      const cur = await get('03', '43'), pend = await get('07', '47');
      return { current: cur, past: pend };
    }
    async clearDTC() { const l = await this.query('04', 5000); return !!(l && l.some((x) => /44/.test(x))); }
    async detect() { return this.state; }
    async flashCount() { return null; }
    async close() { this.state = 'OFF'; try { await this.s.close(); } catch (e) {} }
  }

  /* ---------------- scripted ELM327 emulator (tests) ---------------- */
  class FakeElm {
    constructor(o) { o = o || {}; this.diesel = !!o.diesel; this.t = 0; this.buf = ''; this.dtc = ['P0301', 'P0420']; this.cleared = false; }
    write(bytes) {
      for (const b of bytes) this.buf += String.fromCharCode(b);
      let i; while ((i = this.buf.indexOf('\r')) >= 0) { const c = this.buf.slice(0, i).trim().toUpperCase(); this.buf = this.buf.slice(i + 1); setTimeout(() => this._on(c), 1); }
      return Promise.resolve(true);
    }
    _say(t) { if (this.onData) this.onData(Uint8Array.from(Array.from(t + '\r\r>', (c) => c.charCodeAt(0)))); }
    _val(pid) {
      const t = this.t += 0.1, rpm = 1500 + 800 * Math.sin(t), h = (n) => n.toString(16).toUpperCase().padStart(2, '0');
      const M = { 0x04: [60], 0x05: [40 + 90], 0x0B: [50], 0x0C: [(rpm * 4) >> 8, (rpm * 4) & 255], 0x0D: [62], 0x0E: [128 + 20], 0x0F: [40 + 33], 0x11: [30], 0x42: [0x36, 0xB0], 0x5C: [40 + 95], 0x51: [this.diesel ? 4 : 1], 0x33: [100], 0x2F: [128],
        0x70: [3, 0x03, 0xE8, 0, 0, 0, 0, 0, 0], 0x23: [0x0B, 0xB8] };
      return M[pid] ? M[pid].map(h).join('') : null;
    }
    _on(c) {
      if (c === 'ATZ') return this._say('\rELM327 v1.5');
      if (/^AT/.test(c)) return this._say(c === 'ATRV' ? '12.6V' : c === 'ATDPN' ? 'A6' : 'OK');
      if (c === '03') return this._say(this.cleared ? '43 00' : '43 02 03 01 04 20');
      if (c === '07') return this._say('47 00');
      if (c === '04') { this.cleared = true; return this._say('44'); }
      if (/^01[0-9A-F]{2}/.test(c)) {
        const pids = c.slice(2).match(/../g).map((x) => parseInt(x, 16)); let out = '41';
        for (const p of pids) {
          if (p % 0x20 === 0) { const base = p; const sup = this.diesel ? [0x04, 0x05, 0x0B, 0x0C, 0x0D, 0x0F, 0x11, 0x23, 0x42, 0x51, 0x5C, 0x70] : [0x04, 0x05, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x11, 0x2F, 0x33, 0x42, 0x51, 0x5C]; let m = 0; for (const s of sup) if (s > base && s <= base + 32) m |= 1 << (31 - (s - base - 1)); if (sup.some((s) => s > base + 32)) m |= 1; out += (p).toString(16).padStart(2, '0').toUpperCase() + [m >>> 24, (m >>> 16) & 255, (m >>> 8) & 255, m & 255].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(); continue; }
          const v = this._val(p); if (v == null) continue; out += p.toString(16).toUpperCase().padStart(2, '0') + v;
        }
        return this._say(out.length > 2 ? out.replace(/(..)/g, '$1 ').trim() : 'NO DATA');
      }
      this._say('?');
    }
    close() { return Promise.resolve(); }
  }

  const E = { Elm327, FakeElm, ELM_PIDS: PIDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else Object.assign(root, E);
})(typeof window !== 'undefined' ? window : globalThis);
