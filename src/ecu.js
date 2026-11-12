/* =====================================================================
 * Jet_HONDA Tune — ecu.js
 * Honda Keihin K-line ECU operations over any transport:
 *   transport.wake()                       -> 70ms low / 130ms high + 10400 baud
 *   transport.txrx(frame, ml, timeoutMs)   -> reply bytes (echo removed) | null
 *   transport.sense()  (optional)          -> true if K-line powered
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = (typeof module !== 'undefined' && module.exports) ? require('./proto.js') : root.HP;
  const S = P.STATE;

  class Cancelled extends Error { constructor() { super('ยกเลิกโดยผู้ใช้'); this.cancelled = true; } }

  class HondaECU {
    constructor(transport, opt) {
      opt = opt || {};
      this.t = transport;
      this.log = opt.log || (() => {});
      this.retries = 1;
      this.timeout = opt.timeout || 350;
      this.stats = { tx: 0, rx: 0, bad: 0, retry: 0 };
      this.cancelFlag = false;
      this.state = S.OFF;
      this.ecuId = null;
    }
    cancel() { this.cancelFlag = true; }
    _chk() { if (this.cancelFlag) { this.cancelFlag = false; throw new Cancelled(); } }

    async send(mtype, data, o) {
      o = o || {};
      const retries = o.retries == null ? this.retries : o.retries;
      const timeout = o.timeout || this.timeout;
      const frame = P.buildFrame(mtype, data || []);
      for (let a = 0; a <= retries; a++) {
        if (a) this.stats.retry++;
        this.stats.tx++;
        this.log('tx', frame);
        const r = await this.t.txrx(frame, mtype.length, timeout);
        if (!r || !r.length) { this.log('to', frame); continue; }
        const p = P.parseReply(r, mtype.length);
        if (!p || p.bad) { this.stats.bad++; this.log('bad', r); continue; }
        if (!P.matchType(mtype, p.mtype)) { this.log('bad', r); continue; }
        this.stats.rx++;
        this.log('rx', p.raw);
        if (o.delay) await P.sleep(o.delay);
        return p;
      }
      return null;
    }

    /* ---- session ---- */
    async ping() { return !!(await this.send([0xFE], [0x72], { retries: 0 })); }
    async diag() { return !!(await this.send([0x72], [0x00, 0xF0])); }
    async init() { await this.t.wake(); return this.ping(); }

    async detect() {
      const save = this.retries; this.retries = 0;
      try {
        await this.init();
        let r = await this.send([0x72], [0x71, 0x00]);
        if (!r) { await this.init(); r = await this.send([0x72], [0x71, 0x00]); }
        if (r) {
          const d = r.data;
          this.ecuId = d.slice(2);
          if (d.length >= 7 && (d[5] || d[6])) return (this.state = S.OK);
          if (await this.send([0x7D], [0x01, 0x01, 0x03])) return (this.state = S.RECOVER_OLD);
          if (await this.send([0x7B], [0x00, 0x01, 0x04])) return (this.state = S.RECOVER_NEW);
          return (this.state = S.OK);
        }
        const w = await this.send([0x7E], [0x01, 0x01, 0x00]);
        if (w) return (this.state = (w.data[1] === 0xF0 ? S.ERROR : S.FLASH));
        if (await this.send([0x82, 0x82, 0x10], [0x00])) return (this.state = S.SECURE);
        if (await this.send([0x82, 0x82, 0x00], [0x00, 0x00, 0x00, 0x08])) return (this.state = S.READ);
        if (this.t.sense) { const on = await this.t.sense(); if (on === false) return (this.state = S.OFF); }
        return (this.state = S.UNKNOWN);
      } finally { this.retries = save; }
    }

    /* ---- info / tables / live ---- */
    async readTable(t) { const r = await this.send([0x72], [0x71, t]); return r ? r.data : null; }
    async probeTables() {
      const ids = [0x10, 0x11, 0x13, 0x17, 0x20, 0x21, 0x60, 0x61, 0x63, 0x67, 0x70, 0x71, 0xD0, 0xD1];
      const out = {};
      for (const t of ids) { const d = await this.readTable(t); if (d && d.length > 2) out[t] = d.slice(2); }
      return out;
    }
    async readLive() { const d = await this.readTable(0x11); return d ? P.decodeT11(d) : null; }
    async flashCount() { const r = await this.send([0x7D], [0x01, 0x01, 0x03]); return r ? r.data : null; }

    /* ---- DTC ---- */
    async readDTC() {
      const res = { current: [], past: [] };
      for (const [kind, cmd] of [['current', 0x74], ['past', 0x73]]) {
        for (let i = 1; i <= 0x0B; i++) {
          const r = await this.send([0x72], [cmd, i]);
          if (!r) break;
          const d = r.data;
          if (d.length < 3 || d[2] === 0) break;
          for (const j of [3, 5, 7]) {
            if (j + 1 < d.length && (d[j] || d[j + 1])) {
              const k = d[j] + '-' + d[j + 1];
              if (!res[kind].includes(k)) res[kind].push(k);
            }
          }
        }
      }
      return res;
    }
    async clearDTC() { return !!(await this.send([0x72], [0x60, 0x03])); }

    /* ---- security (service 0x27, 0xE0 + password chunks) ---- */
    async unlock(pw) {
      if (!pw || !pw.length) return false;
      const a = pw.slice(0, 7), b = pw.slice(7);
      const r1 = await this.send([0x27], [0xE0, ...a]);
      if (!r1) return false;
      if (!b.length) return true;
      return !!(await this.send([0x27], [0xE0, ...b]));
    }

    /* ---- READ FLASH (ดูดไฟล์) ---- */
    async readFlash(o) {
      o = o || {};
      const start = o.start || 0, max = o.maxBytes || 0x100000;
      const onProg = o.onProgress || (() => {});
      let size = 12, addr = start;
      const out = new Uint8Array(max); let n = 0;
      const t0 = Date.now();
      while (n < max) {
        this._chk();
        const want = Math.min(size, max - n);
        const r = await this.send([0x82, 0x82, 0x00], [...P.fmtRead(addr), want]);
        if (r && r.len === want + 5) {
          out.set(r.data.slice(0, want), n); n += want; addr += want;
          onProg(n, max, Date.now() - t0);
        } else {
          size--; if (size < 1) break;
        }
      }
      return out.slice(0, n);
    }

    // find a readable start address (for AUTO model)
    async probeStart(cands) {
      for (const a of cands) {
        const r = await this.send([0x82, 0x82, 0x00], [...P.fmtRead(a), 8]);
        if (r && r.len === 13) return a;
      }
      return null;
    }

    /* ---- EEPROM ---- */
    async eepromRead(onProg) {
      const out = new Uint8Array(512);
      for (let i = 0; i < 256; i++) {
        this._chk();
        const r = await this.send([0x82, 0x82, 0x10], [i]);
        if (!r || r.data.length < 2) throw new Error('อ่าน EEPROM ไม่ได้ที่ word ' + i);
        out[i * 2] = r.data[0]; out[i * 2 + 1] = r.data[1];
        onProg && onProg(i + 1, 256);
      }
      let same = true; for (let i = 0; i < 256; i++) if (out[i] !== out[i + 256]) { same = false; break; }
      return same ? out.slice(0, 256) : out;
    }
    async eepromWrite(u8, onProg) {
      const words = u8.length / 2;
      for (let i = 0; i < words; i++) {
        this._chk();
        const r = await this.send([0x82, 0x82, 0x14], [i, u8[i * 2], u8[i * 2 + 1]]);
        if (!r || r.len !== 5) throw new Error('เขียน EEPROM ไม่สำเร็จที่ word ' + i);
        onProg && onProg(i + 1, words);
      }
      return true;
    }
    async eepromFormat(ff) { const r = await this.send([0x82, 0x82, ff ? 0x18 : 0x19], []); return !!(r && r.len === 5); }

    /* ---- WRITE FLASH (อัดไฟล์) ---- */
    async writeStatus() { const r = await this.send([0x7E], [0x01, 0x01, 0x00]); return r && r.data.length > 1 ? r.data[1] : null; }
    async initWrite() {
      for (const d of [[1, 1, 1], [1, 1, 2], [1, 1, 3], [1, 2, 0x50, 0x47, 0x4D], [1, 3, 0x2D, 0x46, 0x49]])
        await this.send([0x7D], d, { delay: 500 });
    }
    async initRecover() {
      for (const d of [[0, 1, 1], [0, 1, 2], [0, 1, 3], [0, 2, 0x76, 0x03, 0x17], [0, 3, 0x75, 0x05, 0x13]])
        await this.send([0x7B], d, { delay: 500 });
    }
    async enterBoot() {
      await this.send([0x72], [0x00, 0xF1]);
      await P.sleep(1000);
      await this.send([0x27], [0x00, 0x01, 0x00]);
      await P.sleep(100);
    }

    async writeFlash(bin, o) {
      o = o || {};
      const start = o.start || 0;
      const stage = o.onStage || (() => {});
      const onProg = o.onProgress || (() => {});
      if (bin.length % 64) throw new Error('ขนาดไฟล์ต้องหารด้วย 64 ลงตัว');
      if (start % 16) throw new Error('Start offset ต้องหารด้วย 16 ลงตัว');
      if (!P.binChecksumOK(bin) && !o.allowBadChecksum) throw new Error('checksum ไฟล์ไม่ผ่าน — แก้ checksum ก่อนอัด');

      // 1) get into FLASH (boot) state — nothing destructive happens before the gate
      stage('ตรวจสถานะกล่อง…');
      let st = await this.detect();
      if (st === S.OFF || st === S.UNKNOWN) throw new Error('ติดต่อกล่องไม่ได้ (' + st + ')');
      if (st !== S.FLASH) {
        stage('เข้าโหมดแฟลช…');
        if (st === S.RECOVER_NEW) await this.initRecover(); else await this.initWrite();
        if ((await this.writeStatus()) == null) await this.enterBoot();
        if ((await this.writeStatus()) == null) {
          await this.t.wake();
          if ((await this.writeStatus()) == null)
            throw new Error('เข้าโหมดแฟลชไม่ได้ — ยังไม่ได้ลบข้อมูล กล่องยังปลอดภัย');
        }
      }
      this.state = S.FLASH;
      this._chk(); // last point where cancel is allowed

      // 2) erase
      stage('ลบข้อมูลเดิม (erase)…');
      await this.writeStatus();
      for (let s = o.eraseWait || 0; s > 0; s--) { stage('รอก่อนลบ ' + s + ' วินาที'); await P.sleep(1000); }
      await this.send([0x7E], [0x01, 0x02]);
      await this.send([0x7E], [0x01, 0x03, 0x00, 0x00]); await this.writeStatus();
      await this.send([0x7E], [0x01, 0x0B, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF]); await this.writeStatus();
      await this.send([0x7E], [0x01, 0x0E, 0x01, 0x90]); await P.sleep(40);
      const er = await this.send([0x7E], [0x01, 0x04, 0xFF]);
      if (!er) throw new Error('สั่งลบไม่สำเร็จ (ไม่มีการตอบกลับ) — ลองอัดใหม่');
      await P.sleep(o.fast ? 50 : 2000);
      const tEnd = Date.now() + 90000;
      for (;;) {
        const r = await this.send([0x7E], [0x01, 0x05]);
        if (!r) throw new Error('ระหว่างรอลบ กล่องไม่ตอบ — ลองอัดใหม่ทันที (โหมดกู้)');
        if (r.data[1] === 0x00) break;
        if (r.data[1] === 0xFA) throw new Error('ลบไม่สำเร็จ (block error 0xFA)');
        if (Date.now() > tEnd) throw new Error('รอลบนานเกินไป');
        stage('กำลังลบ… สถานะ ' + P.h8(r.data[1]));
        await P.sleep(100);
      }
      await this.writeStatus();

      // 3) write blocks
      let block = o.block || 128;
      const t0 = Date.now();
      const writeAll = async (bs) => {
        const n = bin.length / bs;
        for (let i = 0; i < n; i++) {
          const addr = (start >> 4) + i * (bs >> 4);
          const next = i === n - 1 ? 0 : addr + (bs >> 4);
          const x = [addr >> 8, addr & 0xFF, ...bin.subarray(i * bs, (i + 1) * bs), next >> 8, next & 0xFF];
          const r = await this.send([0x7E], [0x01, 0x06, ...x, P.ck8(x), P.ckHonda(x)], { retries: 2, timeout: 1500 });
          const d = r && r.data;
          if (!r || r.len !== 7 || ((d[d.length - 2] << 8) | d[d.length - 1]) !== next) {
            if (i === 0 && bs === 128) return false;
            throw new Error('เขียน block ที่ ' + P.hx(start + i * bs, 5) + ' ไม่สำเร็จ — อย่าปิดกุญแจ ให้กดอัดใหม่ (โหมดกู้)');
          }
          if (bs === 64 && i % 2 === 1) { await this.send([0x7E], [0x01, 0x07]); await P.sleep(o.fast ? 5 : 200); }
          onProg((i + 1) * bs, bin.length, Date.now() - t0);
        }
        return true;
      };
      stage('กำลังอัดไฟล์…');
      if (!(await writeAll(block))) { block = 64; stage('กำลังอัดไฟล์ (block 64)…'); await writeAll(64); }

      // 4) post write
      stage('ปิดงานแฟลช / ตรวจสอบ…');
      for (const c of [0x08, 0x09, 0x0A]) { await this.send([0x7E], [0x01, c]); await P.sleep(o.fast ? 5 : 500); await this.writeStatus(); }
      await this.send([0x7E], [0x01, 0x0C]); await P.sleep(o.fast ? 5 : 500);
      await this.writeStatus();
      const fin = await this.send([0x7E], [0x01, 0x0D]);
      const ok = !!(fin && fin.data[1] === 0x0F);
      stage(ok ? 'อัดไฟล์สำเร็จ ✔ ปิดกุญแจ 10 วินาทีแล้วเปิดใหม่' : 'อัดเสร็จแต่ตรวจสอบท้ายไม่ผ่าน');
      return ok;
    }
  }

  const E = { HondaECU, Cancelled };
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else Object.assign(root, E);
})(typeof window !== 'undefined' ? window : globalThis);
