/* ============================================================================
 * v1.6.10 — values from the Smart Gauge screen INTO the app (screen -> app)
 *
 * The screen (Jet_SmartGauge_CAR v1.0.15+) answers MFB-LINK over its USB cable (115200 baud), and from firmware v1.0.17 over Bluetooth LE too (Nordic UART, data only):
 *   LIVE 0x21     48 bytes with every live reading (rpm, speed, throttle, MAP, coolant, intake, battery, timing, injector, AFR, lambda, CRP, oil, load)
 *   LOG_GET 0x22  kind 2 = the screen's own AFR map (7 throttle rows x 8 rpm columns, with sample counts)
 * Here those readings are turned into the app's own keys (RPM, SPD, TPS, MAP, ECT, IAT, BATT, IGN, INJ, AFR, LAMB, CRP, EOT, LOAD, FRATE) and go through
 * exactly the same path as an OBD sample: Dash tiles, rev arc, graphs, drag log, AFR LOG (JetHooks).
 *   - no OBD adapter connected: the screen is the only source and drives the Dash by itself
 *   - an OBD adapter / K-line is also reading: the OBD value always wins, a value it does not have is filled in from the screen
 * The AFR map of the screen can be imported into the app's AFR LOG (only what is new since the last import).
 * The first half is pure (node tests); the second half needs the app (JetCore).
 * ========================================================================== */
(function (root) {
  'use strict';
  const u16 = (p, i) => p[i] | (p[i + 1] << 8), s16 = (p, i) => (u16(p, i) << 16) >> 16, u32 = (p, i) => (p[i] | (p[i + 1] << 8) | (p[i + 2] << 16) | (p[i + 3] << 24)) >>> 0;

  /* ---------- LIVE 0x21 (the bytes AFTER the status byte) ---------- */
  function decodeLive(p) {
    if (!p || p.length < 48 || p[0] !== 1) return null;
    const f = u16(p, 4), v = (b, x) => ((f >> b) & 1 ? x : null);
    return {
      mode: p[1] ? 'kline' : 'car', linked: !!(p[2] & 1), demo: !!(p[2] & 2), diesel: !!(p[2] & 4), hybrid: !!(p[2] & 8), bike: !!(p[2] & 16), mil: !!(p[2] & 32),
      rpm: v(0, u16(p, 6)), speed: v(1, u16(p, 8) / 10), tps: v(2, u16(p, 10) / 10), map: v(3, u16(p, 12) / 10), ect: v(4, s16(p, 14) / 10), iat: v(5, s16(p, 16) / 10),
      batt: v(6, u16(p, 18) / 100), timing: v(7, s16(p, 20) / 10), inj: v(8, u16(p, 22) / 100), afr: v(9, u16(p, 24) / 100), lambda: v(10, u16(p, 26) / 1000),
      crpMPa: v(11, u16(p, 28) / 10), crpV: v(11, u16(p, 30) / 1000), boost: v(12, s16(p, 32) / 10), fuelLh: v(13, u16(p, 34) / 100), oil: v(14, s16(p, 36) / 10), load: v(15, u16(p, 38) / 10),
      tripKm: u32(p, 40) / 1000, tripSec: u32(p, 44),
    };
  }
  // the screen's name for a value -> the app's key
  const KEYS = [['rpm', 'RPM'], ['speed', 'SPD'], ['tps', 'TPS'], ['map', 'MAP'], ['ect', 'ECT'], ['iat', 'IAT'], ['batt', 'BATT'], ['timing', 'IGN'], ['inj', 'INJ'],
    ['afr', 'AFR'], ['lambda', 'LAMB'], ['crpV', 'CRP'], ['oil', 'EOT'], ['load', 'LOAD'], ['fuelLh', 'FRATE']];
  // decoded LIVE -> a sample with the app's keys; gk = which keys came from the screen (so they are never sent back to it)
  function liveToD(L) {
    const d = {}, gk = {};
    if (!L) return { d, gk };
    for (const [a, k] of KEYS) {
      const x = L[a]; if (x == null || !isFinite(x)) continue;
      if ((k === 'AFR' || k === 'LAMB') && !(x > 0)) continue;           // 0 = the screen has no wideband reading
      d[k] = x; gk[k] = 1;
    }
    return { d, gk };
  }

  /* ---------- LOG_GET 0x22 ---------- */
  function decodeLog(p) {
    if (!p || p.length < 4 || p[0] > 2) return null;
    const kind = p[0], rows = p[1], cols = p[2], rpmStep = p[3] * 100; let o = 4;
    if (kind === 2) {
      if (p.length < 4 + rows + rows * cols * 4) return null;
      const tps = Array.from(p.slice(o, o + rows)); o += rows; const cells = [];
      for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++, o += 4) { const n = u16(p, o); row.push({ n, avg: n ? u16(p, o + 2) / 100 : null }); } cells.push(row); }
      return { kind, tps, rpmStep, cells };
    }
    const bands = [];
    for (let c = 0; c < cols; c++, o += 8) { const n = u16(p, o); bands.push({ n, avg: n ? u16(p, o + 2) / 100 : null, min: n ? u16(p, o + 4) / 100 : null, max: n ? u16(p, o + 6) / 100 : null }); }
    return { kind, rpmStep, bands };
  }

  /* ---------- the screen's AFR map -> cells of the app's AFR LOG ----------
   * map  = decodeLog(kind 2); prev = the snapshot taken at the last import ({'r,c': {n, avg}}); axisPos = HT.axisPos; info = the AFR LOG's axisInfo
   * Gives { cells: [{r, c, n, avg}] (only the NEW samples), snap (what to remember), added, spots } or null when the app grid cannot take it.
   * A screen row is a throttle band (row i = TBV[i] .. TBV[i+1]) and a column an rpm band (column c = c*step .. (c+1)*step): the app cell is the one at the middle of the band. */
  function importPlan(map, prev, ys, xs, info, axisPos) {
    if (!map || map.kind !== 2 || !info || info.load !== 'TPS' || !ys || !xs) return null;
    prev = prev || {};
    const cells = [], snap = {}; let added = 0;
    map.cells.forEach((row, ri) => {
      const lo = map.tps[ri], hi = ri + 1 < map.tps.length ? map.tps[ri + 1] : 100, tps = (lo + hi) / 2;
      row.forEach((cell, ci) => {
        if (!cell.n) return;
        const key = ri + ',' + ci; snap[key] = { n: cell.n, avg: cell.avg };
        let pn = 0, pa = 0; const q = prev[key]; if (q && q.n <= cell.n) { pn = q.n; pa = q.avg; }           // the screen's log was cleared (fewer samples than before): take it all again
        const dn = cell.n - pn; if (dn <= 0) return;
        let avg = pn ? (cell.n * cell.avg - pn * pa) / dn : cell.avg;
        if (!(avg >= 6.0001 && avg <= 24.9999)) return;
        const rpm = (ci + 0.5) * map.rpmStep / info.mul;
        const fr = axisPos(ys, info.rpmRows ? rpm : tps), fc = axisPos(xs, info.rpmRows ? tps : rpm);
        if (fr == null || fc == null) return;
        cells.push({ r: Math.round(fr), c: Math.round(fc), n: dn, avg }); added += dn;
      });
    });
    return { cells, snap, added, spots: cells.length };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { decodeLive, decodeLog, liveToD, importPlan, KEYS }; return; }
  if (!root.JetCore) return;

  /* ======================= phone side ======================= */
  const C = root.JetCore, { st, $, esc, toast } = C;
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const FRESH = 1500;
  // state: off | conn (cable open, nothing yet) | flow | idle (screen has no values: car off / not linked) | demo | stall (no answer) | old (firmware without LIVE)
  const F = { on: false, g: null, dev: null, state: 'off', msg: '', last: null, t: 0, n: 0, fails: 0, hist: [], rate: 0, since: 0, info: null, run: 0, retry: 0, asked: 0 };
  const viaOf = () => (F.g && F.g.via === 'ble' ? 'ble' : 'usb');
  const ecuLive = () => !!(st.ecu && st.live);
  const flowing = () => F.on && F.state === 'flow' && F.rate > 0.3;

  // the OBD / K-line sample is missing a value the screen has: fill it in (called from mergeSensors)
  function fill(d) {
    const L = F.last; if (!F.on || !L || Date.now() - F.t > FRESH || F.state !== 'flow') return d;
    const gk = d.gk || (d.gk = {});
    for (const k in L) if (d[k] == null) { d[k] = L[k]; gk[k] = 1; }
    return d;
  }
  async function ingest(L) {
    const { d, gk } = liveToD(L);
    if (!Object.keys(d).length) { F.state = L.demo ? 'demo' : 'idle'; F.last = null; return; }
    F.info = { mode: L.mode, bike: L.bike, diesel: L.diesel, mil: L.mil, tripKm: L.tripKm }; F.t = Date.now(); F.last = d;
    // v1.0.18 screens have a DEMO mode (bench test, no car): the numbers are made up. They ARE shown (that is what the mode is for: trying the app without a car) but
    // marked `demo`, so nothing records or learns from them (AFR LOG, throttle / rev-scale learning, distance) and an OBD value is never replaced by them
    F.state = L.demo ? 'demo' : 'flow';
    if (ecuLive()) return;                                                                    // the OBD loop is drawing: the screen only fills the gaps (never with DEMO numbers)
    const x = Object.assign({}, d); x.gk = Object.assign({}, gk); x.gsrc = 1; if (L.demo) x.demo = 1;
    await C.mergeSensors(x); C.showLive(x); C.emitLive(x);
  }
  async function loop(g, run) {
    let cyc = 0, shown = F.state;
    while (F.run === run && F.g === g && st.gauge === g && !g.lost) {
      F.asked++; const r = await g.request(0x21, [], 700);
      if (F.run !== run) break;
      const L = r && r[0] === 0 ? decodeLive(Array.from(r.slice(1))) : null;
      if (L) { F.fails = 0; F.n++; try { await ingest(L); } catch (e) { console.error(e); } }
      else if (r && r[0] === 2) { F.state = 'old'; F.last = null; break; }                    // refused: firmware older than v1.0.15
      else if (++F.fails >= 3 && F.state !== 'stall') { F.state = 'stall'; F.last = null; }
      if (++cyc % 5 === 0 && !g.noSensors) { try { const s = await g.sensors(); if (s && F.run === run) st.sens = F.state === 'demo' ? null : s; } catch (e) { /* ignore */ } }   // O2 volts etc. that LIVE does not carry
      if (F.state !== shown) { shown = F.state; render(); try { C.pills(); C.log(F.state === 'stall' || F.state === 'old' ? 'warn' : 'info', 'รับค่าจากจอ Smart Gauge (' + viaOf() + '): ' + F.state + ' · ' + (g.fw || '') + ' · ถามจอแล้ว ' + F.asked + ' ครั้ง · จอตอบ ' + F.n); } catch (e) { /* ignore */ } }
      await sleep(F.fails ? 500 : ecuLive() ? 500 : 50);
    }
    if (F.run === run) { F.on = F.state === 'old' && st.gauge === g; if (!F.on) { F.state = 'off'; F.last = null; } }
    render();
  }
  function start(g, dev) {
    stop(); if (!g || !g.request) return;
    F.retry = 0; F.on = true; F.g = g; F.dev = dev || null; F.state = 'conn'; F.last = null; F.n = 0; F.asked = 0; F.fails = 0; F.hist = []; F.rate = 0; F.since = Date.now(); F.info = null;
    if (g.via === 'ble' && root.JetGaugeLink && root.JetGaugeLink.state() !== 'off') {            // Bluetooth in both directions at once would collide: the phone is either the adapter of the screen or its receiver
      root.JetGaugeLink.stop(); toast('ปิดลิงก์จอ (โทรศัพท์เป็นอะแดปเตอร์) แล้ว — รับค่าจากจอทาง Bluetooth ทีละทิศทางเพื่อไม่ให้สัญญาณชนกัน', 6500);
    }
    const run = ++F.run; render(); loop(g, run);
  }
  function stop() { F.run++; F.on = false; F.g = null; F.state = 'off'; F.last = null; render(); }
  // the link dropped (cable pulled, phone out of range): a Bluetooth link is looked for again for about a minute, a cable needs the person
  function lost(g) {
    const dev = F.g === g ? F.dev : null, ble = g && g.via === 'ble'; stop();
    if (!ble || !dev || !dev.addr) return;                                                      // only the Android app knows the address to look for again; a browser needs a tap
    const id = ++F.retry; toast('จอหลุดการเชื่อมต่อ — กำลังเชื่อม Bluetooth ใหม่…', 4000);
    (async () => {
      for (let i = 0; i < 10 && F.retry === id; i++) {
        await sleep(6000); if (F.retry !== id || st.gauge) return;
        try { await C.connect('gauge-only', dev); } catch (e) { /* tried again below */ }
        if (st.gauge) return;
      }
      if (F.retry === id) { F.retry = 0; toast('เชื่อมจอใหม่ไม่สำเร็จ — กดเชื่อม Bluetooth ในหน้า Setup อีกครั้ง', 6000); }
    })();
  }
  async function disconnect() {
    const g = F.g; F.retry = 0; stop();
    if (g) { try { await g.close(); } catch (e) { /* gone */ } if (st.gauge === g) st.gauge = null; st.sens = null; toast('ตัดการเชื่อมต่อจอแล้ว'); try { C.pills(); } catch (e) { /* ignore */ } }
    render();
  }

  /* ---------- status in Setup ---------- */
  const fmt = (k, d) => { const c = C.CH && C.CH[k]; return (c ? c.l : k) + ' ' + C.chText(d, k) + (c && c.u ? ' ' + c.u : ''); };
  function render() {
    const info = $('#gfInfo'), btn = $('#gfBtn'), bbtn = $('#gfBle'), imp = $('#gfImp'), box = $('#gfVals'); if (!info || !btn) return;
    const on = F.on && st.gauge === F.g, via = viaOf(), usb = !!(root.JetApp || ('serial' in navigator)), ble = !!(root.JetNative || (typeof navigator !== 'undefined' && navigator.bluetooth));
    btn.textContent = on && via === 'usb' ? '⏹ ตัดสาย USB จอ' : '🔌 เชื่อมสาย USB';
    btn.disabled = !usb || (on && via === 'ble');
    if (bbtn) { bbtn.textContent = on && via === 'ble' ? '⏹ ตัด Bluetooth จอ' : '📶 เชื่อม Bluetooth'; bbtn.disabled = !ble || (on && via === 'usb'); }
    if (imp) imp.hidden = !(on && F.state !== 'old' && F.state !== 'stall' && F.state !== 'demo');
    let h;
    if (!usb && !ble) h = 'เบราว์เซอร์นี้ไม่รองรับ USB / Bluetooth — ใช้แอป Android หรือ Chrome / Edge';
    else if (!on && F.state !== 'old') h = F.retry ? '🟡 จอหลุดการเชื่อมต่อ — กำลังเชื่อม Bluetooth ใหม่…' : 'ยังไม่ได้เชื่อม — เชื่อมจอ Smart Gauge ทางสาย USB (OTG) หรือ Bluetooth';
    else if (F.state === 'conn') h = via === 'ble' ? '🟡 เชื่อม Bluetooth แล้ว — รอจอส่งค่า…' : '🟡 เปิดสาย USB แล้ว — รอจอส่งค่า…';
    else if (F.state === 'flow') h = '🟢 รับค่าจากจอ ' + esc((F.g && (F.g.fw || F.g.name)) || 'Smart Gauge') + (via === 'ble' ? ' · Bluetooth' : ' · USB') + ' · ' + F.rate.toFixed(1) + ' ครั้ง/วินาที' + (ecuLive() ? ' · ใช้เติมค่าที่ OBD ไม่มี' : ' · ป้อนเข้า Dash / AFR LOG');
    else if (F.state === 'idle') h = '🟡 เชื่อมจอแล้ว แต่จอยังไม่มีค่า (จอยังไม่ได้ต่อรถ / กุญแจยังไม่ ON)';
    else if (F.state === 'demo') h = '🟠 จออยู่ในโหมดทดลอง (DEMO) — แสดงค่าจำลองบน Dash ให้ลองแอปได้ แต่ไม่บันทึกลง AFR LOG และไม่ปรับค่าที่แอปจำไว้';
    else if (F.state === 'stall') h = via === 'ble' ? '🔴 จอไม่ตอบ — อยู่ใกล้จอหรือไม่ / จอเปิดอยู่หรือไม่' : '🔴 จอไม่ตอบ — ตรวจสาย USB / เปิดจอไว้หรือไม่';
    else if (F.state === 'old') h = '🔴 เฟิร์มแวร์จอรุ่นเก่า ยังไม่มีคำสั่งส่งค่า — อัปเดตจอเป็น v1.0.15 ขึ้นไป';
    else h = '';
    if (on && (F.state === 'conn' || F.state === 'idle' || F.state === 'stall')) h += ' · ถามจอแล้ว ' + F.asked + ' ครั้ง · จอตอบ ' + F.n;       // what to read out when the values do not show
    info.innerHTML = h;
    if (box) {
      const d = (F.state === 'flow' || F.state === 'demo') && F.last ? F.last : null;
      box.hidden = !d;
      if (d) box.innerHTML = Object.keys(d).map((k) => '<span class="gfv">' + esc(fmt(k, d)) + '</span>').join('');
    }
  }
  function tick() {
    const now = Date.now(), h = F.hist; h.push([now, F.n]); while (h.length > 2 && now - h[0][0] > 3200) h.shift();
    const a = h[0], dt = (now - a[0]) / 1000; F.rate = F.on && dt > 0.4 ? (F.n - a[1]) / dt : 0;
    if ($('#mSet') && $('#mSet').classList.contains('show')) render();
  }
  setInterval(tick, 500);

  /* ---------- the screen's AFR map -> the app's AFR LOG ---------- */
  async function importAfr() {
    const g = F.g, A = root.JetAfr; if (!F.on || !g || st.gauge !== g) return toast('ยังไม่ได้เชื่อมจอ');
    if (F.state === 'demo') return toast('จออยู่ในโหมด DEMO — ตาราง AFR เป็นของจำลอง ไม่นำเข้า', 5000);
    if (!A || !A.log || !A.info) return toast('เปิดหน้า AFR LOG ก่อน');
    if (A.mode === 'crp') return toast('AFR LOG อยู่ในโหมด CRP — สลับเป็น AFR ก่อนนำเข้า', 5000);
    if (A.info.load !== 'TPS') return toast('ตาราง AFR LOG ใช้ MAP เป็นแกน — นำเข้าจากจอไม่ได้ (จอเก็บตาม TPS)', 5000);
    const r = await g.request(0x22, [2], 1500);
    const m = r && r[0] === 0 ? decodeLog(Array.from(r.slice(1))) : null;
    if (!m || m.kind !== 2) return toast('จอไม่ส่งตาราง AFR — จอยังไม่มีข้อมูล หรือเป็นเฟิร์มแวร์รุ่นเก่า', 5000);
    const key = 'jht.gf.imp.' + A.sig, mem = LS.get(key, null);
    const prev = mem && A.log.total >= (mem.appTotal || 0) ? mem.snap : {};                   // the app's log was cleared since the last import: take everything from the screen again
    const plan = importPlan(m, prev, A.ys, A.xs, A.info, root.HT.axisPos);
    if (!plan) return toast('นำเข้าไม่ได้ — ตาราง AFR LOG แกนไม่ตรงกับของจอ', 5000);
    if (!plan.added) { LS.set(key, { snap: plan.snap, appTotal: A.log.total }); return toast('ไม่มีข้อมูลใหม่จากจอ (นำเข้าครบแล้ว)'); }
    A.addCells(plan.cells); LS.set(key, { snap: plan.snap, appTotal: A.log.total });
    toast('นำเข้า AFR LOG จากจอแล้ว · ' + plan.added.toLocaleString('en-US') + ' ตัวอย่าง · ' + plan.spots + ' ช่องในตาราง', 5000);
  }

  const pressed = async (kind) => {
    if (F.on && F.g && st.gauge === F.g) return disconnect();
    F.retry = 0;                                                                                  // a press by hand replaces the automatic search
    C.modal('#mSet', false);
    if (kind === 'usb') await C.connect('gauge-only-usb'); else if (root.JetNative) await C.connectBt('gauge'); else await C.connect('gauge-only');
    render();
  };
  if ($('#gfBtn')) $('#gfBtn').onclick = () => pressed('usb');
  if ($('#gfBle')) $('#gfBle').onclick = () => pressed('ble');
  if ($('#bSet')) $('#bSet').addEventListener('click', render);
  if ($('#gfImp')) $('#gfImp').onclick = () => importAfr().catch((e) => toast(e.message || String(e), 5000));
  render();

  root.JetGaugeFeed = { start, stop, lost, disconnect, fill, state: () => F.state, active: () => F.on, via: viaOf, bleActive: () => F.on && viaOf() === 'ble', flowing, importAfr, F };
})(typeof window !== 'undefined' ? window : globalThis);
