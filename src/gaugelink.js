/* =====================================================================
 * Jet Smart Gauge — gaugelink.js : LINK TO THE SMART GAUGE SCREEN (Jet_SmartGauge_CAR, ESP32 CYD)
 *
 * The screen looks for an ELM327 OBD-II adapter over Bluetooth and asks it for values. This phone presents itself as one
 * (Android app: Bluetooth LE service FFF0, see JetBridge.jlink*) and answers the screen's requests with the values the app has read from the car,
 * so the screen needs no new firmware and no wires. ElmEmu below is the small ELM327 look-alike (AT commands + OBD-II mode 01).
 * ===================================================================== */
(function (root) {
  'use strict';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const u8 = (v) => [clamp(Math.round(v), 0, 255)];
  const u16 = (v) => { const n = clamp(Math.round(v), 0, 65535); return [n >> 8, n & 255]; };

  // the OBD-II PIDs the phone offers: app value key(s) (first one that has a fresh value wins) + the SAE J1979 encoding
  const OFFER = {
    0x04: { k: ['LOAD'], nm: 'โหลดเครื่อง', u: '%', dg: 0, f: (v) => u8(v * 255 / 100) },
    0x05: { k: ['ECT'], nm: 'น้ำหล่อเย็น', u: '°C', dg: 0, f: (v) => u8(v + 40) },
    0x0B: { k: ['MAP'], nm: 'แรงดันท่อไอดี (MAP)', u: 'kPa', dg: 0, f: (v) => u8(v) },
    0x0C: { k: ['RPM'], nm: 'รอบเครื่อง', u: 'rpm', dg: 0, f: (v) => u16(v * 4) },
    0x0D: { k: ['SPD', 'GPS'], nm: 'ความเร็ว', u: 'km/h', dg: 0, f: (v) => u8(v) },
    0x0E: { k: ['IGN'], nm: 'ไทมิ่ง', u: '°', dg: 1, f: (v) => u8((v + 64) * 2) },
    0x0F: { k: ['IAT'], nm: 'อากาศเข้า', u: '°C', dg: 0, f: (v) => u8(v + 40) },
    0x10: { k: ['MAF'], nm: 'ปริมาณอากาศ (MAF)', u: 'g/s', dg: 1, f: (v) => u16(v * 100) },
    0x11: { k: ['TPS'], nm: 'คันเร่ง (TPS)', u: '%', dg: 0, f: (v) => u8(v * 255 / 100) },
    0x24: { k: ['LAMBDA'], nm: 'AFR (ส่งเป็นค่า lambda)', u: 'λ', dg: 2, f: (v) => u16(clamp(v, 0.3, 1.999) * 32768).concat([0x80, 0x00]) },   // lambda (A B) + sensor current 0 mA (C D)
    0x33: { k: ['BARO'], nm: 'ความดันบรรยากาศ', u: 'kPa', dg: 0, f: (v) => u8(v) },
    0x42: { k: ['BATT'], nm: 'แรงดันแบต', u: 'V', dg: 1, f: (v) => u16(v * 1000) },
    0x46: { k: ['AMB'], nm: 'อากาศภายนอก', u: '°C', dg: 0, f: (v) => u8(v + 40) },
    0x5C: { k: ['EOT'], nm: 'น้ำมันเครื่อง', u: '°C', dg: 0, f: (v) => u8(v + 40) },
  };
  const MODE_NAME = { 2: 'ค่าตอนเกิดปัญหา (freeze frame)', 3: 'อ่านโค้ดเสีย (DTC)', 4: 'ลบโค้ดเสีย', 7: 'โค้ดเสียที่รอยืนยัน', 9: 'เลข VIN / ข้อมูล ECU', 10: 'โค้ดเสียถาวร' };
  const hex2 = (n) => (n < 16 ? '0' : '') + n.toString(16).toUpperCase();

  class ElmEmu {
    /** opt.value(key) -> number | null (fresh value or nothing) · opt.out(text) -> send text to the screen */
    constructor(opt) { this.value = opt.value; this.out = opt.out; this.n = 0; this.hits = {}; this.miss = {}; this.reset(); }
    stats() { this.hits = {}; this.miss = {}; this.n = 0; }
    reset() { this.echo = true; this.spaces = true; this.buf = ''; }
    feed(u) {
      for (let i = 0; i < u.length; i++) {
        const b = u[i];
        if (b === 13) { const c = this.buf; this.buf = ''; this._line(c); }
        else if (b === 10 || b === 0) continue;
        else { this.buf += String.fromCharCode(b); if (this.buf.length > 80) this.buf = ''; }
      }
    }
    _line(raw) {
      this.n++;
      const c = raw.replace(/\s+/g, '').toUpperCase(), echo = this.echo ? raw + '\r' : '';
      const lines = !c ? [] : c.slice(0, 2) === 'AT' ? this._at(c.slice(2)) : this._obd(c);
      this.out(echo + (lines.length ? lines.join('\r') + '\r' : '') + '\r>');
    }
    _at(a) {
      if (a === 'Z' || a === 'WS') { this.reset(); return ['', 'ELM327 v1.5']; }
      if (a === 'D') { this.echo = true; this.spaces = true; return ['OK']; }
      if (a === 'I') return ['ELM327 v1.5'];
      if (a === '@1') return ['OBDII to RS232 Interpreter'];
      if (a === 'DPN') return ['A6'];                                   // "automatic, ISO 15765-4 CAN 11/500": the screen then asks several values in one request
      if (a === 'DP') return ['AUTO, ISO 15765-4 (CAN 11/500)'];
      if (a === 'RV') { const v = this.value('BATT'); return [(v != null ? v : 12.6).toFixed(1) + 'V']; }
      if (a === 'E0' || a === 'E1') { this.echo = a === 'E1'; return ['OK']; }
      if (a === 'S0' || a === 'S1') { this.spaces = a === 'S1'; return ['OK']; }
      if (/^(L[01]|H[01]|M[01]|R[01]|CAF[01]|CFC[01]|AL|NL|BI|AT[0-2]|ST[0-9A-F]{1,2}|SP[0-9A-C]|TP[0-9A-C]|SPA?[0-9A-C]?|SH[0-9A-F]+|CRA[0-9A-F]*|CM[0-9A-F]+|CF[0-9A-F]+|FC.*|SW[0-9A-F]+|WM.*|TA[0-9A-F]+|SS|JS.*|JHF[01]|JTM.*|PB.*|V[01]|CSM[01]|FI|SI|D[01])$/.test(a)) return ['OK'];
      return ['?'];
    }
    _map(base) {                                                        // "supported PIDs" bitmap for base+1 .. base+32
      const m = [0, 0, 0, 0];
      for (const k of Object.keys(OFFER)) {
        const p = +k;
        if (p > base && p <= base + 32) { const i = p - base - 1; m[i >> 3] |= 0x80 >> (i & 7); }
        else if (p > base + 32) m[3] |= 1;                              // more PIDs in the next range
      }
      return m;
    }
    _miss(label) { const m = this.miss[label] || (this.miss[label] = { n: 0, t: 0 }); m.n++; m.t = Date.now(); }
    _fmt(bytes) { return bytes.map(hex2).join(this.spaces ? ' ' : ''); }
    _obd(c) {
      if (!/^[0-9A-F]+$/.test(c) || c.length < 2) return ['?'];
      const mode = parseInt(c.slice(0, 2), 16);
      let rest = c.slice(2);
      if (mode !== 1) { if (mode >= 2 && mode <= 10) this._miss(MODE_NAME[mode] || 'โหมด ' + mode); return mode >= 2 && mode <= 10 ? ['NO DATA'] : ['?']; }   // codes / VIN etc.: not offered
      if (rest.length % 2) rest = rest.slice(0, -1);                      // the trailing "number of replies" digit (010C1)
      if (!rest.length) return ['?'];
      const out = [0x41];
      for (let i = 0; i + 1 < rest.length && i < 12; i += 2) {
        const id = parseInt(rest.substr(i, 2), 16);
        if (id % 32 === 0 && id <= 0xC0) { out.push(id, ...this._map(id)); continue; }
        const o = OFFER[id]; if (!o) { this._miss('PID ' + hex2(id)); continue; }
        let v = null; for (const k of o.k) { const x = this.value(k); if (x != null) { v = x; break; } }
        const h = this.hits[id] || (this.hits[id] = { n: 0, ok: 0, t: 0 }); h.n++; h.t = Date.now();
        if (v != null) { out.push(id, ...o.f(v)); h.ok++; }
      }
      return out.length > 1 ? [this._fmt(out)] : ['NO DATA'];
    }
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { ElmEmu, OFFER }; return; }
  if (!root.JetCore) return;

  /* ---------------- phone side: values from the app -> the screen ---------------- */
  const C = root.JetCore, { st, S, saveS, $, esc, toast } = C;
  const N = root.JetNative, B = root.JetBt || {};
  const GL = { state: 'off', msg: '', dev: '', vals: {}, keyT: {}, fresh: 4000 };
  const fresh = (k) => { const t = GL.keyT[k]; return t != null && Date.now() - t <= GL.fresh ? GL.vals[k] : null; };
  const emu = new ElmEmu({
    value: fresh,
    out: (txt) => { if (N && N.jlinkSend && B.b64e) N.jlinkSend(B.b64e(Array.from(txt, (c) => c.charCodeAt(0) & 255))); },
  });
  GL.emu = emu;
  (root.JetHooks = root.JetHooks || []).push((d) => {
    const now = Date.now(), v = GL.vals;
    const gk = d.gk || {};                                                  // values that came FROM the screen (v1.6.10) are not sent back to it (they would never expire)
    for (const k in d) { const x = d[k]; if (typeof x === 'number' && isFinite(x) && !gk[k]) { v[k] = x; GL.keyT[k] = now; } }
    const t = st.t, sto = (t && t.stoich) || 14.7;
    if (gk.AFR || gk.LAMB) { /* the screen's own wideband: nothing to send back */ }
    else if (typeof d.AFR === 'number' && isFinite(d.AFR) && d.AFR > 0) { v.LAMBDA = d.AFR / sto; GL.keyT.LAMBDA = now; }      // the AFR the app shows, as lambda
    else if (typeof d.LAMB === 'number' && isFinite(d.LAMB)) { v.LAMBDA = d.LAMB; GL.keyT.LAMBDA = now; }
  });

  function setState(state, msg, dev) {
    const was = GL.state;
    GL.state = state; GL.msg = msg || ''; GL.dev = dev || GL.dev;
    if (state === 'conn' && was !== 'conn') { emu.reset(); emu.stats(); GL.hist = []; GL.since = Date.now(); }                  // a new connection starts as a fresh adapter
    if (state !== 'conn') GL.dev = '';
    try { if (root.JetApp) root.JetApp.keepScreen(state === 'conn'); } catch (e) {}        // the phone must stay awake while the screen is linked
    render();
  }
  if (B.Bus) {
    B.Bus.h['jlink-state'] = (e) => { if (e) setState(e.state, e.msg, e.dev); };
    B.Bus.h['jlink-rx'] = (b64) => { try { emu.feed(B.b64d(b64)); } catch (err) { console.error(err); } };
  }
  function start(silent) {
    if (!N || !N.jlinkStart) { setState('fail', 'ใช้ได้เฉพาะในแอป Android รุ่นใหม่ (v1.6.8 ขึ้นไป)'); return; }
    S.jlink = 1; saveS(); setState('wait', ''); N.jlinkStart();
    if (!silent) toast('เปิดลิงก์จอ Smart Gauge แล้ว');
  }
  function stop() {
    S.jlink = 0; saveS();
    if (N && N.jlinkStop) N.jlinkStop();
    setState('off', '');
  }
  const hasData = () => ['RPM', 'SPD', 'TPS', 'ECT'].some((k) => fresh(k) != null);
  // how busy the screen is: requests per second over the last ~3 s, and whether it asked recently (the header icon pulses while it does)
  GL.hist = [];
  function rate() {
    const now = Date.now(), h = GL.hist; h.push([now, emu.n]); while (h.length > 2 && now - h[0][0] > 3200) h.shift();
    const a = h[0], dt = (now - a[0]) / 1000; return dt > 0.4 ? (emu.n - a[1]) / dt : 0;
  }
  const flowing = () => GL.state === 'conn' && GL.rate > 0.3;
  function chip() {
    const b = $('#pSync'), t = $('#tSync'); if (!b || !t) return;
    const gf = root.JetGaugeFeed, usb = !!(gf && gf.active() && gf.state() !== 'old'), uf = usb && gf.flowing();         // v1.6.10: the USB cable that brings the screen's values into the app lights the same chip
    const on = GL.state === 'adv' || GL.state === 'conn' || usb;
    b.hidden = !on; if (!on) return;
    const f = flowing() || uf, c = GL.state === 'conn' || usb;
    b.className = 'chipst' + (c ? (f ? ' on sync' : ' mid') : '');
    t.innerHTML = (f ? '📺⇄' : '📺') + '<span class="sw"> ' + (c ? (f ? 'SYNC' : 'IDLE') : 'READY') + '</span>';   // landscape phones show the icon only (CSS)
  }
  const fmtV = (v, dg) => (Math.round(v * Math.pow(10, dg)) / Math.pow(10, dg)).toFixed(dg);
  function ago(t) { if (!t) return '—'; const d = Math.round((Date.now() - t) / 1000); return d < 2 ? 'ตอนนี้' : d + ' วิที่แล้ว'; }
  function renderSync() {
    const m = $('#mSync'); if (!m || !m.classList.contains('show')) return;
    const c = GL.state === 'conn', r = GL.rate || 0;
    $('#syInfo').innerHTML = c
      ? '🟢 <b>กำลังซิงค์กับจอ</b> ' + esc(GL.dev || 'Smart Gauge') + ' · จอถามค่า: ' + emu.n + ' · ' + r.toFixed(1) + ' ครั้ง/วินาที · ต่ออยู่นาน ' + Math.max(0, Math.round((Date.now() - (GL.since || Date.now())) / 1000)) + ' วินาที'
      : GL.state === 'adv' ? '🟡 พร้อมให้จอต่อ — ยังไม่มีจอมาต่อ' : '⚪ ลิงก์จอปิดอยู่';
    const sto = (st.t && st.t.stoich) || 14.7;
    let h = '';
    for (const id of Object.keys(OFFER).map(Number).sort((a, b) => a - b)) {
      const o = OFFER[id], x = emu.hits[id] || { n: 0, ok: 0, t: 0 };
      let v = null; for (const k of o.k) { const y = fresh(k); if (y != null) { v = y; break; } }
      const val = v == null ? '<span class="mut">— ไม่มีค่า</span>' : id === 0x24 ? 'AFR ' + fmtV(v * sto, 1) + ' <span class="mut">(λ ' + fmtV(v, 2) + ')</span>' : fmtV(v, o.dg) + ' <span class="mut">' + o.u + '</span>';
      h += '<tr' + (x.t && Date.now() - x.t < 1500 ? ' class="hot"' : '') + '><td>' + esc(o.nm) + '</td><td class="mut">' + hex2(id) + '</td><td>' + val + '</td><td class="mut">' + x.n + (x.t ? ' · ' + ago(x.t) : '') + '</td></tr>';
    }
    $('#syBody').innerHTML = h;
    const miss = Object.keys(emu.miss).map((k) => esc(k) + ' ×' + emu.miss[k].n);
    $('#syMiss').innerHTML = miss.length ? 'จอขอแต่แอปไม่มีให้: ' + miss.join(' · ') : 'จอยังไม่ได้ขอค่าที่แอปไม่มีให้';
  }
  function tick() {
    GL.rate = GL.state === 'conn' ? rate() : 0;
    chip(); renderSync();
    if (GL.state === 'conn' && $('#mSet') && $('#mSet').classList.contains('show')) render();
  }
  if ($('#pSync')) $('#pSync').onclick = () => { if (GL.state === 'adv' || GL.state === 'conn') { C.modal('#mSync', true); renderSync(); } else if ($('#bSet')) $('#bSet').click(); };      // the USB feed has no panel of its own: its status is in Setup
  if ($('#jlSync')) $('#jlSync').onclick = () => { C.modal('#mSync', true); renderSync(); };
  function render() {
    const info = $('#jlInfo'), btn = $('#jlBtn');
    if (!info || !btn) return;
    const can = !!(N && N.jlinkStart), s = GL.state;
    btn.disabled = !can;
    btn.textContent = s === 'off' || s === 'fail' ? '📺 เปิดลิงก์จอ Smart Gauge' : '⏹ ปิดลิงก์จอ Smart Gauge';
    let h;
    if (!can) h = 'ใช้ได้เฉพาะในแอป Android รุ่นใหม่';
    else if (s === 'off') h = 'ปิดอยู่ — กดเปิด แล้วบนจอ Smart Gauge: SETUP → Bluetooth → เลือกชื่อบลูทูธของโทรศัพท์เครื่องนี้';
    else if (s === 'wait') h = 'กำลังเปิดลิงก์…';
    else if (s === 'adv') h = '🟡 พร้อมให้จอต่อ — บนจอ: SETUP → Bluetooth → เลือกชื่อบลูทูธของโทรศัพท์เครื่องนี้ (รายการที่ขึ้นเป็นอะแดปเตอร์ OBD)';
    else if (s === 'conn') h = '🟢 จอต่ออยู่: ' + esc(GL.dev || 'Smart Gauge') + ' · จอถามค่า: ' + emu.n + ' · ' + (hasData() ? 'ส่งค่าจากรถให้จออยู่' : 'ยังไม่มีค่าจากรถ — เชื่อมรถแล้วกด LIVE');
    else h = '🔴 ' + esc(GL.msg || 'ลิงก์จอไม่สำเร็จ');
    info.innerHTML = h;
    const sb = $('#jlSync'); if (sb) sb.hidden = !(s === 'adv' || s === 'conn');
    chip();
  }
  if ($('#jlBtn')) $('#jlBtn').onclick = () => { if (GL.state === 'off' || GL.state === 'fail') start(false); else stop(); };
  setInterval(tick, 500);
  root.JetGaugeLink = { start, stop, state: () => GL.state, emu, tick };
  render();
  if (S.jlink && N && N.jlinkStart) setTimeout(() => start(true), 2500);                // it was on last time
})(typeof window !== 'undefined' ? window : globalThis);
