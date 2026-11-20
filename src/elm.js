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
    0x14: ['O2', 2, (b) => A(b) / 200], 0x0F: ['IAT', 1, (b) => A(b) - 40], 0x10: ['MAF', 2, (b) => u16(b) / 100], 0x11: ['TPS', 1, (b) => A(b) * 100 / 255],
    0x1F: ['RUNT', 2, u16], 0x21: ['MILD', 2, u16], 0x22: ['FRPR', 2, (b) => u16(b) * 0.079], 0x23: ['FRP', 2, (b) => u16(b) * 10],
    0x2C: ['EGRC', 1, (b) => A(b) * 100 / 255], 0x2D: ['EGRE', 1, (b) => A(b) * 100 / 128 - 100], 0x2E: ['EVAPC', 1, (b) => A(b) * 100 / 255],
    0x2F: ['FUELL', 1, (b) => A(b) * 100 / 255], 0x30: ['WARM', 1, A], 0x31: ['DISTC', 2, u16], 0x32: ['EVAPP', 2, (b) => s16(b) / 4],
    0x24: ['LAMB', 4, (b) => u16(b) * 2 / 65536], 0x25: ['LAMB2', 4, (b) => u16(b) * 2 / 65536], 0x33: ['BARO', 1, A],
    0x34: ['LAMB', 4, (b) => u16(b) * 2 / 65536], 0x35: ['LAMB2', 4, (b) => u16(b) * 2 / 65536],
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
    0xD1: ['INJ', 2, (b) => u16(b) / 100],
    0x83: ['NOX', 5, (b) => u16(b.slice(1, 3))], 0x85: ['NOX', 9, (b) => u16(b.slice(1, 3))],
  };
  // polled every cycle (fast) vs. every Nth cycle (slow)
  const FAST = ['RPM', 'SPD', 'TPS', 'MAP', 'ECT', 'IAT', 'LOAD', 'IGN', 'MAF', 'BOOST', 'LAMB', 'O2', 'INJ'];
  const MAX_PER_REQ = 6;
  // an ECU answers "not available" with all-ones bytes: such values must never reach the screen as numbers (FFFF = 16383 rpm, lambda 1.99997 …)
  const LAMB_OK = (v) => v < 1.9999;
  const PLAUS = { 0x0C: (v) => v < 16000, 0x10: (v) => v < 650, 0x42: (v) => v < 40, 0x5E: (v) => v < 3000, 0x24: LAMB_OK, 0x25: LAMB_OK, 0x34: LAMB_OK, 0x35: LAMB_OK, 0x44: LAMB_OK };

  class Elm327 {
    constructor(stream, o) {
      o = o || {};
      this.kind = 'obd'; this.name = o.name || 'ELM327'; this.via = 'bt'; this.s = stream; this.state = 'OFF';
      this.buf = ''; this.waiter = null; this.supported = new Set(); this.cycle = 0; this.last = {}; this.log = o.log || (() => {});
      this.fuel = 'g'; this.proto = ''; this.ver = ''; this.single = false; this.honda = false; this.shortCnt = 0; this.fuelType = 1; this.hybrid = false; this.stoich = 14.7; this.ident = {}; this.extraFast = new Set(); this.atrvOk = false; this.useCnt = false; this.tuned = false; this.miss = 0; this.rtt = 80; this.rp = 0; this.ringKey = ''; this.ring = []; this.clone = !!o.clone; this.liveTO = 1500; this.hz = 0; this.tPrev = 0; this.opts = o; this.pfail = {}; this.pskip = {}; this.multiBad = 0; this.afrPref = o.afrPref || 'auto'; this.safe = o.safe || 0; this.gap = [0, 25, 50][Math.min(2, this.safe)]; this.lastGood = 0; this.deadMs = o.deadMs || 8000; this.stats = { tx: 0, rx: 0, retry: 0, bad: 0 };
      stream.onData = (u) => this._rx(u);
      stream.onLost = (why) => { this.state = 'OFF'; if (this.waiter) { const w = this.waiter; this.waiter = null; w(null); } if (this.onLost) this.onLost(why); };    // a pending request ends now, not after its timeout
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
      if (!r) { await sleep(300); r = await this.query('ATZ', 5000); }                    // clones (KONNWEI KW90x …) can miss the first reset
      if (!r) { r = await this.query('ATI', 3000); if (!r) throw new Error('ELM327 ไม่ตอบ — ตรวจว่าเสียบที่รถและจับคู่ Bluetooth แล้ว (PIN 1234 / 0000)'); }
      this.ver = (r.find((l) => /ELM|OBD|v\d/i.test(l)) || '').replace(/[^\x20-\x7e]/g, '');
      // a short gap between the AT commands: cheap clones (blue ELM327 MINI, KW90x) lose commands when the Bluetooth side outruns the bus side
      for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATST32']) { await this.query(c, 1500); await sleep(70); }
      let ok = false, bus = false; this.last0100 = '';
      const tryRead = async (to) => {                       // 0100 = "which PIDs do you support": the first sign that the car answers
        const l = await this.query('0100', to); this.last0100 = l ? l.join(' | ') : '(ไม่มีคำตอบ)';
        if (l && l.some((x) => /41\s?00/.test(x.replace(/\s/g, '').replace(/^SEARCHING\.\.\./, '')))) return true;
        if (l && l.some((x) => /UNABLE|ERROR|CAN ERROR|BUS/i.test(x))) bus = true;
        return false;
      };
      // auto protocol; first 0100 can be slow (SEARCHING…, bus init)
      const lp = String(this.opts.lastProto || '');
      if (/^[3-8]$/.test(lp)) {                             // the protocol that worked last time on this adapter: connects in a second instead of searching
        const a = await this.query('ATSP' + lp, 1500); await sleep(70);
        if (a && a.some((x) => /^OK/i.test(x)) && await tryRead(4000)) ok = true; else this.log('info', 'ELM: โปรโตคอลที่จำไว้ (' + lp + ') ใช้ไม่ได้ — ค้นหาใหม่');
      }
      if (!ok) { await this.query('ATSP0', 1500);
        for (let i = 0; i < 3 && !ok; i++) { ok = await tryRead(12000); if (!ok) await sleep(500); } }
      if (!ok && bus) {
        // the adapter is alive but its automatic protocol search gave up (common with cheap clones): try the usual protocols one by one
        for (const sp of [['6', 4000], ['5', 8000], ['3', 8000], ['4', 8000], ['8', 4000]]) {
          this.log('info', 'ELM: ลองโปรโตคอล ' + sp[0]);
          const a = await this.query('ATSP' + sp[0], 1500); await sleep(70);
          if (!(a && a.some((x) => /^OK/i.test(x)))) continue;                       // this adapter does not offer it
          if (await tryRead(sp[1])) { ok = true; break; }
        }
        if (!ok) await this.query('ATSP0', 1500);
      }
      if (!ok) { this.state = 'NOECU'; throw new Error('ต่อ ELM327 ได้ แต่ไม่เจอ ECU — เปิดสวิตช์กุญแจ (ON) แล้วลองใหม่' + (this.last0100 ? ' (ELM ตอบ: ' + this.last0100 + ')' : '')); }
      const pr = await this.query('ATDPN', 1500); this.proto = pr ? pr.join('').replace(/^A/, '') : '';
      this.honda = /^H/.test(this.proto);          // HONDA-KLINE bridge speaking the Honda PGM-FI tables (protocol 'H')
      this.single = !/^[6-9]/.test(this.proto) || this.safe >= 2;    // several PIDs per request only work on CAN; older ISO/KWP/J1850 cars need one PID per request (also: adapter that keeps dropping → gentlest mode)
      this.liveTO = /^[6-9]/.test(this.proto) && !this.safe ? 800 : 1500;      // CAN answers in milliseconds: a silent adapter is noticed quickly
      if (/^[3-5]$/.test(this.proto)) await this.query('ATST64', 1000);      // slow K-line ECUs: allow 400 ms for an answer
      await this._scan();
      try { await this.readIdent(); } catch (e) { /* identification is optional */ }
      try { await this._tune(); } catch (e) { /* timing tweaks are optional */ }
      this.log('info', 'อแดปเตอร์ ' + (this.ver || 'ELM327') + (this.safe ? ' · โหมดปลอดภัย ' + this.safe : '') + ' · โปรโตคอล ' + (this.proto || '?') + ' · ' + (this.single ? 'ถามทีละค่า' : 'หลายค่า/คำสั่ง') + ' · นับคำตอบ ' + (this.useCnt ? 'ใช่' : 'ไม่') + ' · AT2 ' + (this.tuned ? 'ใช่' : 'ไม่'));
      this.state = 'OK';
      return true;
    }
    /** ELM327 prints long CAN answers as a byte-count line plus numbered lines ("00B" / "0: 41 0C .." / "1: .."): join them into one hex string per message */
    _join(lines) {
      const out = []; let cur = null, want = 0;
      const flush = () => { if (cur) out.push(want ? cur.slice(0, want * 2) : cur); cur = null; want = 0; };
      for (const ln of lines || []) {
        const t = String(ln).trim().toUpperCase(), m = /^([0-9A-F]):\s*(.*)$/.exec(t);
        if (m) { if (cur == null) cur = ''; cur += m[2].replace(/[^0-9A-F]/g, ''); continue; }
        flush();
        if (/^[0-9A-F]{3}$/.test(t)) { cur = ''; want = parseInt(t, 16); continue; }          // the byte-count line of a multi-frame answer
        if (t && /^[0-9A-F\s]+$/.test(t)) out.push(t.replace(/\s/g, ''));
      }
      flush(); return out;
    }
    _hexBytes(lines, mode, pid) {
      // join all lines; with ATH0/ATS0 each ECU's reply is "41 0C 1A F8". use the first one that matches
      const head = (mode + 0x40).toString(16).toUpperCase().padStart(2, '0') + (pid == null ? '' : pid.toString(16).toUpperCase().padStart(2, '0'));
      const out = [];
      for (const h of this._join(lines)) {
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
      // response-count digit ("01001"): the adapter stops waiting as soon as the car has answered — only used when this adapter proves it understands it
      this.useCnt = false;
      if (!this.honda && this.safe < 1) { const l = await this.query('01001', 3000); this.useCnt = !!(l && this._join(l).some((h) => /^4100/.test(h))); }
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
      if (this.honda && !this.supported.has(0xD1)) { const l = await this.query('01D1', 1500); const r = l && this._hexBytes(l, 1, 0xD1)[0]; if (r && r.length >= 2) this.supported.add(0xD1); }
      // fuel type (PID 51): 4 = diesel
      if (this.supported.has(0x51)) {
        const l = await this.query('0151', 1500); const r = l && this._hexBytes(l, 1, 0x51)[0];
        if (r && r.length) { this.fuelType = r[0]; this.fuel = [4, 19, 23].includes(r[0]) ? 'd' : 'g'; this.hybrid = r[0] >= 17 && r[0] <= 22; }
      }
      else if (this.honda) this.fuel = 'g';
      else this.fuel = [0x70, 0x23, 0x78, 0x7C, 0x83].some((p) => this.supported.has(p)) && !this.supported.has(0x0E) ? 'd' : 'g';
      if (this.supported.has(0x5B)) this.hybrid = true;                    // hybrid battery pack life
      // stoichiometric air/fuel ratio of the fuel in use (AFR = lambda x this)
      const ST = { 1: 14.7, 2: 6.4, 3: 9.0, 4: 14.5, 5: 15.5, 6: 17.2, 7: 15.7, 9: 14.7, 17: 14.7, 19: 14.5, 23: 14.5 };
      this.stoich = ST[this.fuelType] || (this.fuel === 'd' ? 14.5 : 14.7);
      const rv = await this.query('ATRV', 1500); this.atrvOk = !!(rv && /([0-9.]+)\s*V/i.test(rv.join(' ')));
      this.pidList = Array.from(this.supported).filter((p) => PIDS[p]).sort((a, b) => a - b);
      this.log('info', 'OBD-II: รองรับ ' + this.pidList.length + ' ค่า · ' + (this.fuel === 'd' ? 'ดีเซล' : 'เบนซิน') + (this.proto ? ' · โปรโตคอล ' + this.proto : ''));
    }
    async _read(pids, retry) {
      const out = {}, got = new Set(); this._got = got;
      const cmd = '01' + pids.map((p) => p.toString(16).toUpperCase().padStart(2, '0')).join('') + (this.useCnt ? '1' : '');   // trailing "1" = stop after one answer (no waiting for the ST timeout)
      const t0 = Date.now();
      const l = await this.query(cmd, this.liveTO);
      if (!l) return out;
      if (this.useCnt && !retry && l.some((x) => x === '?')) { this.useCnt = false; return this._read(pids, true); }   // this adapter does not know the digit: go back to plain requests
      this.rtt = this.rtt * 0.8 + (Date.now() - t0) * 0.2;
      // several PIDs in one answer: "41 0C xx xx 0D yy" (single-ECU) — walk the byte stream; long CAN answers arrive as several numbered lines
      for (const h of this._join(l)) {
        if (!/^41/i.test(h)) continue;
        const by = (h.slice(2).match(/../g) || []).map((x) => parseInt(x, 16));
        let i = 0;
        while (i < by.length) {
          const pid = by[i], e = PIDS[pid];
          if (!e) break;
          const data = by.slice(i + 1, i + 1 + e[1]);
          if (data.length < e[1]) break;
          const v = e[2](data); if (isFinite(v) && (!PLAUS[pid] || PLAUS[pid](v))) { out[e[0]] = v; got.add(pid); }
          i += 1 + e[1];
        }
      }
      return out;
    }
    /** build the rotating list: values the Dash shows (fast) come up 3x as often as the rest */
    _mkRing(skip) {
      const key = (p) => PIDS[p][0], k = this.pidList.join(',') + '|' + Array.from(this.extraFast).join(',') + '|' + skip.join(',');
      if (k === this.ringKey) return; this.ringKey = k; this.rp = 0;
      const F = [], S = [];
      for (const p of this.pidList) { if (skip.includes(p)) continue; (FAST.includes(key(p)) || this.extraFast.has(key(p)) ? F : S).push(p); }
      const items = [];
      F.forEach((p, j) => { for (let c = 0; c < 3; c++) items.push([(c * F.length + j + 0.5) / (3 * F.length), p]); });
      S.forEach((p, i) => items.push([(i + 0.5) / S.length, p]));
      this.ring = items.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    }
    async readLive() {
      if (this.state !== 'OK') return null;
      // every cycle: RPM (+ a few core values). The remaining slots rotate through all other supported values, so a cycle always takes about the same time
      // (the old "everything every 12th cycle" burst froze the display for a moment) — the number of requests per cycle follows the adapter's measured speed
      const nowT = Date.now(); if (this.tPrev && nowT - this.tPrev < 2000) this.hz = this.hz ? this.hz * 0.8 + 200 / Math.max(1, nowT - this.tPrev) : 1000 / Math.max(1, nowT - this.tPrev); this.tPrev = nowT;   // measured refresh rate (cycles/s) for the info box
      const c = this.cycle++, key = (p) => PIDS[p][0];
      const has = (k) => this.pidList.find((p) => key(p) === k);
      const rpm = has('RPM'), AK = { wb: 'LAMB', o2: 'O2', cmd: 'EQR' }[this.afrPref], afrKeys = ['LAMB', 'O2', 'EQR'].filter((k) => has(k) && !(k === 'O2' && this.fuel === 'd'));
      const afrP = has(AK && afrKeys.includes(AK) ? AK : afrKeys[0]);       // the AFR source the Dash is going to use gets the every-cycle slot (single-value cars)
      const per = this.single ? 1 : MAX_PER_REQ;
      const reqs = this.single ? Math.max(3, Math.min(5, Math.round(300 / Math.max(20, this.rtt)))) : Math.max(1, Math.min(this.safe ? 2 : 3, Math.round(150 / Math.max(20, this.rtt))));
      const slots = reqs * per, want = [], add = (p) => { if (p != null && !want.includes(p) && (p === rpm || (this.pskip[p] || 0) <= c)) want.push(p); };      // a PID that keeps answering nothing sits out for a while
      let ringN = 0;
      add(rpm);
      if (this.single) {
        // one value per request: RPM + AFR every cycle, the next slots cycle through TPS → SPD → two rotating values (MAP, temperatures, …)
        add(afrP);
        const extra = Math.max(0, slots - want.length), L = ['TPS', 'SPD'].map(has).filter((p) => p != null); L.push('*', '*');
        if (extra >= L.length) { for (const x of L) if (x !== '*') add(x); ringN = extra - (L.length - 2); }
        else for (let k = 0; k < extra; k++) { const x = L[(c * extra + k) % L.length]; if (x === '*') ringN++; else add(x); }
        this._mkRing([rpm, afrP]);
      } else {
        // several values per request (CAN): the core values ride along in every request, the free slots rotate through the rest
        const core = ['SPD', 'TPS', 'MAP'].concat(afrKeys).map(has).filter((p) => p != null);
        const keep = Math.max(0, Math.min(core.length, slots - (rpm != null ? 1 : 0) - 2));
        for (const p of core.slice(0, keep)) add(p);
        ringN = slots - want.length;
        this._mkRing([rpm].concat(core));
      }
      for (let g = 0; ringN > 0 && this.ring.length && g < this.ring.length * 2; g++) {
        const p = this.ring[this.rp % this.ring.length]; this.rp = (this.rp + 1) % this.ring.length;
        if (!want.includes(p) && (this.pskip[p] || 0) <= c) { want.push(p); ringN--; }
      }
      if (!want.length) return null;
      const d = Object.assign({}, this.last);
      let any = 0;
      for (let i = 0; i < want.length; i += per) {
        const g = want.slice(i, i + per);
        const r = await this._read(g), ok = new Set(this._got), gotN = ok.size;
        let silent = false;
        if (g.length > 1) {
          if (!gotN) {                      // nothing decoded: the car is silent, or this adapter cannot take combined requests — one plain RPM request tells which
            const r1 = rpm != null ? await this._read([rpm]) : {};
            if (this._got.size) { Object.assign(r, r1); this._got.forEach((x) => ok.add(x)); if (++this.multiBad >= 2) this._goSingle(); } else silent = true;
          } else { this.multiBad = 0; if (gotN < g.length) { if (++this.shortCnt >= 6) this._goSingle(); } else this.shortCnt = 0; }     // only part of a combined request answered 6 times running → one value per request
        }
        if (!silent) for (const p of g) {
          if (ok.has(p)) { this.pfail[p] = 0; this.pskip[p] = 0; }
          else if (p !== rpm && (this.pfail[p] = (this.pfail[p] || 0) + 1) >= 3) { this.pfail[p] = 3; this.pskip[p] = c + 30; }      // 3 misses in a row: leave it alone for 30 cycles
        }
        any += Object.keys(r).length;
        Object.assign(d, r);
        if (this.gap) await sleep(this.gap);                // gentle mode: give a fragile adapter time to breathe
      }
      if (any) this.lastGood = Date.now(); else if (!this.lastGood) this.lastGood = Date.now();
      if (this.tuned && !any && ++this.miss >= 3) { this.miss = 0; await this._untune(); }      // faster timing made the car stop answering: go back to the safe values
      else if (any) this.miss = 0;
      if (c % 6 === 0 && !this.supported.has(0x42) && this.atrvOk) { const l = await this.query('ATRV', 1500); const m = l && /([0-9.]+)\s*V/i.exec(l.join(' ')); if (m) d.BATT = parseFloat(m[1]); }
      this.last = d;
      if (Date.now() - this.lastGood > this.deadMs) return null;       // nothing fresh for a long while: do not keep showing old numbers as if they were live
      return Object.assign({}, d);   // OBD keys (P.OBD) feed Dash/Grid directly
    }
    _goSingle() { this.single = true; this.pfail = {}; this.pskip = {}; this.ring = []; this.ringKey = ''; }      // one value per request from now on: every value gets a fresh chance
    /** does the adapter itself still answer (as opposed to the car)? */
    async alive() { const l = await this.query('ATI', 1500); return !!l; }
    /** faster adapter timing (ELM327 "adaptive timing 2" + shorter ST on CAN) — verified with a real request, reverted when the adapter or car does not like it */
    async _tune() {
      if (this.honda || this.safe >= 1) return;
      const ok = (l) => l && l.some((x) => /^OK/i.test(x));
      const probe = async () => { const l = await this.query('010C' + (this.useCnt ? '1' : ''), 1500); return !!(l && this._join(l).some((h) => /^410C/.test(h))); };
      if (!ok(await this.query('ATAT2', 1500))) { await this.query('ATAT1', 1500); return; }
      if (/^[6-9]/.test(this.proto)) await this.query('ATST19', 1500);                    // CAN answers in tens of ms: 100 ms ceiling is plenty
      if (await probe() && await probe()) { this.tuned = true; this.log('info', 'ปรับจังหวะ ELM แล้ว (AT2' + (this.useCnt ? ' + นับคำตอบ' : '') + ')'); }
      else await this._untune();
    }
    async _untune() { this.tuned = false; await this.query('ATAT1', 1500); await this.query(/^[3-5]$/.test(this.proto) ? 'ATST64' : 'ATST32', 1500); this.log('warn', 'ELM: กลับไปใช้จังหวะมาตรฐาน'); }
    /** VIN / calibration id (Mode 09) — works for CAN (multi-frame "0:" lines) and for ISO/KWP (one "49 02 0n" line per part) */
    _ascii(lines, pid, vin) {
      let out = '';
      for (const ln of lines || []) {
        let h = ln.toUpperCase().replace(/^[0-9A-F]:/, '').replace(/[^0-9A-F]/g, '');
        if (!h || (h.length === 3 && !/[:\s]/.test(ln))) continue;            // the "014" byte-count line
        const by = (h.match(/../g) || []).map((x) => parseInt(x, 16));
        const data = by[0] === 0x49 && by[1] === pid ? by.slice(3) : by;
        for (const c of data) if (vin ? /[0-9A-HJ-NPR-Z]/.test(String.fromCharCode(c)) : (c >= 0x20 && c < 0x7f)) out += String.fromCharCode(c);
      }
      return vin ? out.slice(0, 17) : out.trim();
    }
    async readIdent() {
      const id = {};
      if (!this.honda) { const v = this._ascii(await this.query('0902', 3000), 0x02, true); if (v.length >= 11) id.vin = v; }
      const cal = this._ascii(await this.query('0904', 2000), 0x04, false); if (cal.length >= 3 && !/NO DATA|UNABLE|ERROR|\?/i.test(cal)) id.cal = cal;
      this.ident = id; return id;
    }
    /** the channel keys this vehicle really reports (used to pick the 6 Dash tiles) */
    channelKeys() {
      const k = new Set((this.pidList || []).map((p) => PIDS[p][0]));
      if (this.honda) k.add('INJ');
      if (this.atrvOk) k.add('BATT');
      if (k.has('LAMB') || k.has('EQR') || (k.has('O2') && this.fuel !== 'd')) k.add('AFR');        // O2 = narrowband voltage → estimated AFR
      return k;
    }
    watch(keys) { this.extraFast = new Set(keys || []); }
    async readDTC() {
      const dec = (by) => { const o = []; for (let i = 0; i + 1 < by.length; i += 2) { const a = by[i], b = by[i + 1]; if (!a && !b) continue; if (this.honda) { o.push(a + '-' + b); continue; } o.push('PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16).toUpperCase() + (b >> 4).toString(16).toUpperCase() + (b & 15).toString(16).toUpperCase()); } return o; };
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
    // o: { diesel, honda, noMulti, lambda(false = no PID 24/34), eqr(true = has commanded lambda 44), vin, kwp(VIN as ISO lines), cal }
    constructor(o) {
      o = o || {}; this.diesel = !!o.diesel; this.noMulti = !!o.noMulti || !!o.honda; this.hondaBridge = !!o.honda; this.lambda = o.lambda !== false; this.eqr = !!o.eqr;
      this.vin = o.vin || ''; this.kwp = !!o.kwp; this.cal = o.cal || ''; this.latency = o.latency || 0; this.wait = o.wait == null ? 0 : o.wait; this.digit = o.digit !== false; this.at2 = o.atat2 !== false; this.zFail = o.zFail || 0; this.deaf = new Set(o.deaf || []); this.junk = new Set(o.junk || []); this.partial = o.partial || 0; this.sent = []; this.o2V = o.o2V == null ? null : o.o2V; this.needSp = o.needSp == null ? null : String(o.needSp); this.sp = '0'; this.plainMulti = !!o.plainMulti; this.nreq = 0; this.pidCount = {}; this.t = 0; this.buf = ''; this.dtc = ['P0301', 'P0420']; this.cleared = false;
    }
    write(bytes) {
      for (const b of bytes) this.buf += String.fromCharCode(b);
      let i; while ((i = this.buf.indexOf('\r')) >= 0) { const c = this.buf.slice(0, i).trim().toUpperCase(); this.buf = this.buf.slice(i + 1); this._cmd(c); }
      return Promise.resolve(true);
    }
    _cmd(c) {
      if (c === 'ATZ' && this.zFail > 0) { this.zFail--; return; }                    // clone that misses the first reset
      // timing model: bus round trip + (without the response-count digit) the ELM keeps waiting for more answers
      let cnt = false; if (/^01([0-9A-F]{2})+[0-9A-F]$/.test(c) || /^0[19]([0-9A-F]{2})+[0-9A-F]$/.test(c)) { if (!this.digit) return setTimeout(() => this._say('?'), 1); c = c.slice(0, -1); cnt = true; }
      if (this.muted) return;                                                                // adapter frozen: no answer at all
      this.nreq++; this.sent.push(c);
      setTimeout(() => this._on(c), Math.max(1, this.latency + (/^0[1-9]/.test(c) && !cnt ? this.wait : 0)));
    }
    _say(t) { if (this.onData) this.onData(Uint8Array.from(Array.from(t + '\r\r>', (c) => c.charCodeAt(0)))); }
    _sup() {
      const base = this.diesel ? [0x04, 0x05, 0x0B, 0x0C, 0x0D, 0x0F, 0x11, 0x23, 0x42, 0x51, 0x5C, 0x70, 0x78]
        : [0x04, 0x05, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x11, 0x2F, 0x33, 0x42, 0x51, 0x5C];
      if (this.hondaBridge) return [0x04, 0x05, 0x0B, 0x0C, 0x0D, 0x0F, 0x11, 0x42, 0xD1];
      return base.concat(this.lambda ? [0x34] : []).concat(this.eqr ? [0x44] : []).concat(this.o2V != null ? [0x14] : []);
    }
    _val(pid) {
      const t = this.t += 0.1, rpm = 1500 + 800 * Math.sin(t), h = (n) => n.toString(16).toUpperCase().padStart(2, '0');
      const M = { 0x04: [60], 0x05: [40 + 90], 0x0B: [50], 0x0C: [(rpm * 4) >> 8, (rpm * 4) & 255], 0x0D: [62], 0x0E: [128 + 20], 0x0F: [40 + 33], 0x11: [30], 0x42: [0x36, 0xB0], 0x5C: [40 + 95], 0x51: [this.diesel ? 4 : 1], 0x33: [100], 0x2F: [128],
        0x70: [3, 0x03, 0xE8, 0, 0, 0, 0, 0, 0], 0x23: [0x0B, 0xB8], 0x14: [Math.round((this.o2V || 0) * 200), 0xFF], 0x34: [0x7D, 0xB8, 0x80, 0x00], 0x44: [0x7D, 0xB8], 0x78: [1, 0x0A, 0x8C, 0, 0, 0, 0, 0, 0], 0xD1: [0x02, 0x58] };
      return M[pid] ? M[pid].map(h).join('') : null;
    }
    _vinLines(txt, pid) {
      const hx = (str) => Array.from(str, (c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
      const d = hx(txt);
      if (this.kwp) { const o = []; for (let i = 0, n = 1; i < d.length; i += 4, n++) o.push(['49', pid, '0' + n].concat(['00', '00', '00', '00'].map((z, k) => d[i + k] || '00')).join(' ')); return o.join('\r'); }
      const all = ['49', pid, '01'].concat(d); const cnt = all.length.toString(16).toUpperCase().padStart(3, '0');
      const o = [cnt]; for (let i = 0, n = 0; i < all.length; i += 7, n++) o.push(n + ': ' + all.slice(i, i + 7).join(' ')); return o.join('\r');
    }
    _on(c) {
      if (c === 'ATZ') return this._say('\rELM327 v1.5');
      if (c === 'ATAT2' && !this.at2) return this._say('?');
      if (/^ATSP[0-9A-C]$/.test(c)) { this.sp = c.slice(4); return this._say('OK'); }
      if (c === '0100' && this.needSp !== null && this.sp !== this.needSp) return this._say('SEARCHING...\rUNABLE TO CONNECT');       // the car only answers on one specific protocol
      if (/^AT/.test(c)) return this._say(c === 'ATRV' ? '12.6V' : c === 'ATDPN' ? (this.needSp !== null && this.sp === this.needSp ? this.needSp : this.hondaBridge ? 'AH' : this.noMulti ? 'A5' : 'A6') : 'OK');
      if (c === '03') return this._say(this.cleared ? '43 00 00 00 00 00 00' : this.hondaBridge ? '43 0C 01 15 02 00 00' : '43 02 03 01 04 20');
      if (c === '07') return this._say('47 00');
      if (c === '04') { this.cleared = true; return this._say('44'); }
      if (c === '0902') return this._say(this.vin ? this._vinLines(this.vin, '02') : 'NO DATA');
      if (c === '0904') return this._say(this.cal ? this._vinLines(this.cal, '04') : 'NO DATA');
      if (/^01[0-9A-F]{2}/.test(c)) {
        let pids = c.slice(2).match(/../g).map((x) => parseInt(x, 16)); if (this.noMulti && pids.length > 1) pids = pids.slice(0, 1); if (this.partial && pids.length > this.partial) pids = pids.slice(0, this.partial); let out = '41';
        for (const p of pids) this.pidCount[p] = (this.pidCount[p] || 0) + 1;
        for (const p of pids) {
          if (p % 0x20 === 0) {
            const base = p, sup = this._sup(); let m = 0; for (const s of sup) if (s > base && s <= base + 32) m |= 1 << (31 - (s - base - 1));
            if (sup.some((s) => s > base + 32)) m |= 1;
            out += (p).toString(16).padStart(2, '0').toUpperCase() + [m >>> 24, (m >>> 16) & 255, (m >>> 8) & 255, m & 255].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(); continue;
          }
          if (this.deaf.has(p)) continue;                                                // this PID never gets an answer
          let v = this._val(p); if (v == null) continue; if (this.junk.has(p)) v = 'F'.repeat(v.length);       // "not available" answer: all ones
          out += p.toString(16).toUpperCase().padStart(2, '0') + v;
        }
        if (out.length <= 2) return this._say('NO DATA');
        const by = out.match(/../g);
        if (!this.noMulti && !this.plainMulti && by.length > 7) {                         // real ELM327 (CAN): length line + "0:" "1:" … lines
          const o = [by.length.toString(16).toUpperCase().padStart(3, '0')]; o.push('0: ' + by.slice(0, 6).join(' '));
          for (let i = 6, n = 1; i < by.length; i += 7, n++) o.push((n % 16).toString(16).toUpperCase() + ': ' + by.slice(i, i + 7).join(' '));
          return this._say(o.join('\r'));
        }
        return this._say(by.join(' '));
      }
      this._say('?');
    }
    mute(on) { this.muted = on !== false; }
    lose(why) { if (this.onLost) this.onLost(why); }
    close() { return Promise.resolve(); }
  }

  const E = { Elm327, FakeElm, ELM_PIDS: PIDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else Object.assign(root, E);
})(typeof window !== 'undefined' ? window : globalThis);
