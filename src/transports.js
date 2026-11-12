/* =====================================================================
 * Jet_HONDA Tune — transports.js (browser)
 *  1) DirectKLine  : USB K-line cable (FTDI / CH340 / KKL) via Web Serial, 10400 baud
 *  2) GaugeLink    : Smart Gauge (ESP32) via Bluetooth LE (Nordic UART) or USB serial,
 *                    speaking MFB-LINK; the gauge does the K-line timing.
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.HP;
  const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // app -> gauge (write)
  const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // gauge -> app (notify)

  /* ---------------- byte-stream helper over Web Serial ---------------- */
  class SerialStream {
    constructor() { this.buf = []; this.waiters = []; this.port = null; this.alive = false; }
    async open(port, baud) {
      this.port = port || (await navigator.serial.requestPort());
      await this.port.open({ baudRate: baud, bufferSize: 4096 });
      this.baud = baud; this.alive = true; this._loop(); return this.port;
    }
    async _loop() {
      while (this.alive && this.port && this.port.readable) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            for (const b of value) this.buf.push(b);
            if (this.onData) this.onData(value);
            const w = this.waiters; this.waiters = []; w.forEach((f) => f());
          }
        } catch (e) { /* port lost */ } finally { try { this.reader.releaseLock(); } catch (e) {} }
        if (!this.alive) break;
        await P.sleep(5);
      }
    }
    async write(bytes) { const w = this.port.writable.getWriter(); try { await w.write(new Uint8Array(bytes)); } finally { w.releaseLock(); } }
    async need(n, deadline) {
      while (this.buf.length < n) {
        const left = deadline - Date.now(); if (left <= 0) return false;
        await new Promise((r) => { this.waiters.push(r); setTimeout(r, Math.min(left, 50)); });
      }
      return true;
    }
    async reopen(baud) {
      this.alive = false; try { await this.reader.cancel(); } catch (e) {}
      await P.sleep(2); await this.port.close();
      await this.port.open({ baudRate: baud, bufferSize: 4096 });
      this.baud = baud; this.alive = true; this._loop();
    }
    async close() { this.alive = false; try { await this.reader.cancel(); } catch (e) {} try { await this.port.close(); } catch (e) {} }
  }

  /* ---------------- Android APP native bridge (window.JetNative) ---------------- */
  const NATIVE = !!root.JetNative;
  const b64e = (a) => { let s = ''; const u = a instanceof Uint8Array ? a : Uint8Array.from(a); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const b64d = (s) => { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  const Bus = { h: {} };
  root.JetEvt = (evt, data) => { const f = Bus.h[evt]; if (f) f(data); };
  const waitEvt = (evt, ms) => new Promise((res) => { const tm = setTimeout(() => { Bus.h[evt] = null; res(null); }, ms); Bus.h[evt] = (d) => { clearTimeout(tm); Bus.h[evt] = null; res(d); }; });

  // byte stream over the app's USB-serial driver (FTDI / CH34x / CP210x / PL2303 / CDC)
  class NativeUsbStream {
    constructor() { this.buf = []; this.waiters = []; }
    async open(baud, quiet) {
      const p = waitEvt('usb-open', 60000);
      Bus.h['usb-data'] = (b) => { const u = b64d(b); for (const x of u) this.buf.push(x); if (this.onData) this.onData(u); const w = this.waiters; this.waiters = []; w.forEach((f) => f()); };
      Bus.h['usb-lost'] = () => { if (this.onLost) this.onLost(); };
      root.JetNative.usbOpen(baud, !!quiet);
      const r = await p;
      if (!r || !r.ok) throw new Error(r ? r.err : 'เปิด USB ไม่สำเร็จ (หมดเวลา)');
      this.devName = r.name; this.baud = baud;
    }
    async write(bytes) { if (!root.JetNative.usbWrite(b64e(bytes))) throw new Error('เขียน USB ไม่ได้'); }
    need(n, deadline) { return SerialStream.prototype.need.call(this, n, deadline); }
    async setBreak(on) { root.JetNative.usbSetBreak(!!on); }
    async reopen(baud) { root.JetNative.usbSetBaud(baud); this.baud = baud; }
    async close() { Bus.h['usb-data'] = Bus.h['usb-lost'] = null; root.JetNative.usbClose(); }
  }

  // BLE (Nordic UART) through the app — the app shows its own device picker
  class NativeBle {
    async open() {
      const p = waitEvt('ble-open', 90000);
      Bus.h['ble-data'] = (b) => this.onData && this.onData(b64d(b));
      Bus.h['ble-lost'] = () => this.onLost && this.onLost();
      root.JetNative.bleConnect();
      const r = await p;
      if (!r || !r.ok) throw new Error(r ? r.err : 'เชื่อมต่อ Bluetooth ไม่สำเร็จ');
      this.name = r.name;
    }
    async write(bytes) { if (!root.JetNative.bleWrite(b64e(bytes))) throw new Error('Bluetooth ยังไม่พร้อม'); }
    async close() { Bus.h['ble-data'] = Bus.h['ble-lost'] = null; root.JetNative.bleClose(); }
  }

  /* ---------------- 1) direct USB K-line cable ---------------- */
  class DirectKLine {
    constructor(o) { o = o || {}; this.kind = 'usb'; this.name = 'สาย K-LINE USB'; this.wakeMode = o.wakeMode || 'break'; this.s = NATIVE ? new NativeUsbStream() : new SerialStream(); }
    async open() {
      if (NATIVE) { this.s.onLost = () => this.onLost && this.onLost(); await this.s.open(10400, false); this.name = 'K-LINE ' + this.s.devName; return true; }
      await this.s.open(null, 10400); const i = this.s.port.getInfo ? this.s.port.getInfo() : {}; this.info = i; return true;
    }
    async close() { await this.s.close(); }
    async wake() {
      if (this.wakeMode === 'baud') {
        // 0x00 @ 120 baud ≈ 75 ms low (start + 8 data bits), then back to 10400
        await this.s.reopen(120); await this.s.write([0x00]); await P.sleep(90);
        await this.s.reopen(10400); await P.sleep(100);
      } else if (this.s.setBreak) {
        await this.s.setBreak(true); await P.sleep(70);
        await this.s.setBreak(false); await P.sleep(130);
      } else {
        await this.s.port.setSignals({ break: true }); await P.sleep(70);
        await this.s.port.setSignals({ break: false }); await P.sleep(130);
      }
      this.s.buf.length = 0;
    }
    async txrx(frame, ml, timeout) {
      const s = this.s; s.buf.length = 0;
      await s.write(frame);
      const dl = Date.now() + timeout + Math.ceil(frame.length * 1.1);
      // echo (single-wire K-line): strip if present
      if (await s.need(frame.length, dl)) {
        let echo = true; for (let i = 0; i < frame.length; i++) if (s.buf[i] !== frame[i]) { echo = false; break; }
        if (echo) s.buf.splice(0, frame.length);
      }
      if (!(await s.need(ml + 1, dl))) return null;
      const len = s.buf[ml]; if (len < ml + 2) return null;
      if (!(await s.need(len, dl))) return null;
      return s.buf.splice(0, len);
    }
  }

  /* ---------------- 2) Smart Gauge (MFB-LINK) ---------------- */
  class GaugeLink {
    constructor(via, device) { this.device = device || null; this.kind = via === 'usb' ? 'gauge-usb' : 'gauge-ble'; this.via = via; this.name = 'SMART GAUGE ' + (via === 'usb' ? 'USB' : 'BLE'); this.pending = null; this.parser = new P.LinkParser((t, p) => this._onFrame(t, p)); this.chunk = 180; }
    async open() {
      if (NATIVE) {
        this.s = this.via === 'usb' ? new NativeUsbStream() : new NativeBle();
        this.s.onData = (v) => this.parser.push(v);
        this.s.onLost = () => { this.lost = true; if (this.onLost) this.onLost(); };
        if (this.via === 'usb') { await this.s.open(115200, true); this.name = 'GAUGE USB'; }
        else { await this.s.open(); this.name = 'GAUGE ' + (this.s.name || 'BLE'); }
      } else if (this.via === 'usb') {
        this.s = new SerialStream(); this.s.onData = (v) => this.parser.push(v);
        await this.s.open(null, 115200);
      } else {
        if (!navigator.bluetooth) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Bluetooth (ใช้ Chrome บน Android / PC)');
        this.dev = this.device || await navigator.bluetooth.requestDevice({ filters: [{ services: [NUS] }, { namePrefix: 'Jet' }, { namePrefix: 'MFB' }, { namePrefix: 'Jet' }], optionalServices: [NUS] });
        this.dev.addEventListener('gattserverdisconnected', () => { this.lost = true; if (this.onLost) this.onLost(); });
        const srv = await (await this.dev.gatt.connect()).getPrimaryService(NUS);
        this.rx = await srv.getCharacteristic(NUS_RX); this.tx = await srv.getCharacteristic(NUS_TX);
        await this.tx.startNotifications();
        this.tx.addEventListener('characteristicvaluechanged', (e) => this.parser.push(new Uint8Array(e.target.value.buffer)));
        this.name = 'GAUGE ' + (this.dev.name || 'BLE');
      }
      const r = await this.request(P.LINK.PING, [], 2000);
      if (!r) throw new Error('เชื่อมต่อได้แต่เกจไม่ตอบ (อัปเดตเฟิร์มแวร์เกจเป็น bridge v1) (อัปเดตเฟิร์มแวร์เกจ)');
      this.fw = String.fromCharCode(...r.slice(1));
      return true;
    }
    async fileList() {
      const r = await this.request(P.LINK.FILE_LIST, [], 3000);
      if (!r || r[0]) return null;
      return String.fromCharCode(...r.slice(1)).split('\n').filter(Boolean).map((l) => { const i = l.lastIndexOf(':'); return { name: l.slice(0, i), size: +l.slice(i + 1) }; });
    }
    async close() { if (this.s) await this.s.close(); if (this.dev && this.dev.gatt.connected) this.dev.gatt.disconnect(); }
    _onFrame(t, p) { const q = this.pending; if (q && t === (q.type | 0x80)) { this.pending = null; clearTimeout(q.tm); q.res(p); } }
    async _raw(bytes) {
      if (this.s) return this.s.write(bytes);
      for (let i = 0; i < bytes.length; i += this.chunk) await this.rx.writeValueWithResponse(new Uint8Array(bytes.slice(i, i + this.chunk)));
    }
    async request(type, payload, timeout) {
      while (this.pending) await P.sleep(1);
      return new Promise(async (res) => {
        const q = { type, res, tm: setTimeout(() => { if (this.pending === q) this.pending = null; res(null); }, timeout || 1500) };
        this.pending = q;
        try { await this._raw(P.linkEncode(type, payload)); } catch (e) { clearTimeout(q.tm); this.pending = null; res(null); }
      });
    }
    async wake() { await this.request(P.LINK.WAKE, [], 1500); }
    async sense() { const r = await this.request(P.LINK.SENSE, [], 800); return r ? !!r[1] : null; }
    async txrx(frame, ml, timeout) {
      const r = await this.request(P.LINK.TXRX, [ml, timeout & 0xFF, timeout >> 8, ...frame], timeout + 1200);
      if (!r || r[0] !== P.LINK.ST_OK) return null;
      return r.slice(1);
    }
    async sendFile(name, u8, onProg) {
      const nm = Array.from(new TextEncoder().encode(name.slice(0, 40)));
      const sz = u8.length;
      let r = await this.request(P.LINK.FILE_BEGIN, [sz & 255, (sz >> 8) & 255, (sz >> 16) & 255, sz >>> 24, nm.length, ...nm], 4000);
      if (!r || r[0]) throw new Error('เกจไม่รับไฟล์ (พื้นที่เต็ม?)');
      const CH = 160;
      for (let o = 0; o < sz; o += CH) {
        const d = Array.from(u8.subarray(o, o + CH));
        let ok = false;
        for (let a = 0; a < 3 && !ok; a++) { r = await this.request(P.LINK.FILE_CHUNK, [o & 255, (o >> 8) & 255, (o >> 16) & 255, o >>> 24, ...d], 3000); ok = r && r[0] === 0; }
        if (!ok) throw new Error('ส่งไฟล์สะดุดที่ ' + o);
        onProg && onProg(Math.min(o + CH, sz), sz);
      }
      const c = P.crc32(u8);
      r = await this.request(P.LINK.FILE_END, [c & 255, (c >> 8) & 255, (c >> 16) & 255, c >>> 24], 5000);
      if (!r || r[0]) throw new Error('CRC ไฟล์บนเกจไม่ตรง');
      return true;
    }
  }

  root.JetApp = NATIVE ? { saveFile: (name, u8, mime) => root.JetNative.saveFile(name, b64e(u8), mime || ''), keepScreen: (on) => root.JetNative.keepScreen(!!on) } : null;
  root.DirectKLine = DirectKLine;
  root.GaugeLink = GaugeLink;
})(window);
