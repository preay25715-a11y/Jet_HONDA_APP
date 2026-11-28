/* =====================================================================
 * Jet Smart Gauge — app.js (UI)
 * ===================================================================== */
(function () {
  'use strict';
  const P = window.HP;
  const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s));
  const LS = 'jht.settings';
  const DEF = { theme: '#2a7bff', wake: 'break', timeout: 350, eraseWait: 0, block: 128, pw: '', models: null, modelId: 'auto' };
  const S = Object.assign({}, DEF, JSON.parse(localStorage.getItem(LS) || '{}'));
  const saveS = () => localStorage.setItem(LS, JSON.stringify(S));
  const st = { t: null, gauge: null, ecu: null, busy: false, live: false, files: [], sel: null, ee: null, hexOff: 0, mm: {} };
  const models = () => S.models || P.MODELS;

  /* ---------------- helpers ---------------- */
  const toast = (m, ms) => { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), ms || 2600); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtDate = (d) => { d = new Date(d); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const kb = (n) => (n / 1024).toFixed(n % 1024 ? 1 : 1) + ' KB';
  const parseHex = (s) => { const v = parseInt(String(s).replace(/^0x/i, ''), 16); return isNaN(v) ? 0 : v; };
  const download = (name, data, type) => { if (window.JetApp) { const u = typeof data === 'string' ? new TextEncoder().encode(data) : data; const r = JetApp.saveFile(name, u, type); toast(r ? 'บันทึกแล้ว: ' + r : 'บันทึกไฟล์ไม่สำเร็จ', 4000); return; } const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const modal = (id, on) => $(id).classList.toggle('show', on);
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m && m.id !== 'mDlg') m.classList.remove('show'); }));
  $$('[data-close]').forEach((b) => b.onclick = () => b.closest('.modal').classList.remove('show'));

  /* ---------------- in-app dialogs (work inside the Android WebView) ---------------- */
  function dlg(msg, opt) {
    opt = opt || {};
    return new Promise((res) => {
      $('#dMsg').textContent = msg;
      const inp = $('#dIn'); inp.style.display = opt.input != null ? '' : 'none'; inp.value = opt.input || '';
      $('#dOk').textContent = opt.ok || 'ตกลง'; $('#dOk').className = 'btn ' + (opt.danger ? 'red' : 'pri');
      const done = (v) => { modal('#mDlg', false); $('#dOk').onclick = $('#dNo').onclick = null; res(v); };
      $('#dOk').onclick = () => done(opt.input != null ? inp.value : true);
      $('#dNo').onclick = () => done(opt.input != null ? null : false);
      modal('#mDlg', true); if (opt.input != null) setTimeout(() => inp.focus(), 50);
    });
  }
  const ask = (m, danger) => dlg(m, { danger, ok: danger ? 'ยืนยัน' : 'ตกลง' });
  const askText = (m, def) => dlg(m, { input: def || '' });

  /* ---------------- log ---------------- */
  const logEl = $('#log'); let logN = 0;
  function log(kind, msg) {
    if ((kind === 'tx' || kind === 'rx' || kind === 'to' || kind === 'bad') && !$('#logFrames').checked) return;
    if (Array.isArray(msg) || msg instanceof Uint8Array) msg = P.hex(msg);
    const cls = { tx: 'tx', rx: 'rx', to: 'er', bad: 'er', err: 'er', info: 'in' }[kind] || '';
    const tag = { tx: 'TX ', rx: 'RX ', to: 'TIMEOUT ', bad: 'BAD ', err: 'ERR ', info: '' }[kind] || '';
    const d = document.createElement('div'); d.className = cls;
    d.textContent = new Date().toTimeString().slice(0, 8) + '  ' + tag + msg;
    logEl.appendChild(d); if (++logN > 3000) { logEl.firstChild.remove(); logN--; }
    logEl.scrollTop = logEl.scrollHeight;
  }
  $('#bLogClr').onclick = () => { logEl.innerHTML = ''; logN = 0; };
  $('#bLogSave').onclick = () => download('jet-honda-tune-log.txt', logEl.innerText, 'text/plain');

  /* ---------------- theme ---------------- */
  // theme picker removed — app always uses the blue/black theme
  function applyTheme() { S.theme = DEF.theme; document.documentElement.style.setProperty('--ac', DEF.theme); }

  /* ---------------- logo ---------------- */
  function applyLogo() {   // custom-logo option removed: always show the built-in logo
    try { localStorage.removeItem('jht.logo'); } catch (e) {}
    $('#brandCustom').innerHTML = ''; $('#brandDefault').style.display = 'flex';
  }
  $('#brand').onclick = () => go(0);

  /* ---------------- pages ---------------- */
  const pages = $$('.pages > .page');
  $('#nav').innerHTML = pages.map((p, i) => `<button data-p="${i}">${p.dataset.tab || p.dataset.name}</button>`).join('') + '<button id="bSet">Setup</button>';
  $('#seg').innerHTML = pages.map(() => '<i></i>').join('');
  let curPage = 0;
  function go(i) {
    curPage = i;
    pages.forEach((p, k) => p.classList.toggle('show', k === i));
    $$('#nav button[data-p]').forEach((b, k) => b.classList.toggle('on', k === i));
    $$('#seg i').forEach((b, k) => b.classList.toggle('on', k === i));
    (window.JetPageHooks || []).forEach((f) => { try { f(pages[i].dataset.tab); } catch (e) { console.error(e); } });
  }
  $$('#nav button[data-p]').forEach((b) => b.onclick = () => go(+b.dataset.p));
  const pageOf = (tab) => pages.findIndex((p) => p.dataset.tab === tab);
  const tick = () => { const d = new Date(); $('#clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  tick(); setInterval(tick, 10000);
  let sx = null;
  $('.pages').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $('.pages').addEventListener('touchend', (e) => {
    if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) < 90 || e.target.closest('.hex,.flist,input,select,textarea')) return;
    const cur = curPage;
    go(Math.max(0, Math.min(pages.length - 1, cur + (dx < 0 ? 1 : -1))));
  });

  /* ---------------- status pills ---------------- */
  function pills() {
    const t = st.t;
    const gf = !t && window.JetGaugeFeed && JetGaugeFeed.active();           // v1.6.10: only the screen's USB cable is connected (its values feed the Dash)
    $('#dLink').className = 'dot' + (t || gf ? ' on' : '');
    $('#tLink').textContent = t ? t.name : gf ? (JetGaugeFeed.state() === 'demo' ? 'DEMO · ' : 'GAUGE ') + (JetGaugeFeed.via() === 'ble' ? 'BT' : 'USB') : 'OFFLINE · แตะเพื่อเชื่อมต่อ';
    const s = st.ecu ? st.ecu.state : null;
    const good = s === 'OK' || s === 'SECURE' || s === 'READ';
    $('#tEcu').className = 'chipst' + (good ? ' on' : s && s !== 'OFF' ? ' mid' : '');
    $('#tEcu').textContent = 'ECU ' + (s === 'NOECU' ? 'WAIT' : s || '—');
    $('#pGauge').className = 'chipst' + (st.gauge ? ' on' : '');
    $('#tGauge').textContent = st.gauge ? 'GAUGE ✓' : 'GAUGE';
    const bd = $('#bDemo'); if (bd) bd.classList.toggle('on', !!(t && t.kind === 'demo'));
  }

  /* ---------------- connect ---------------- */
  $('#bConnect').onclick = () => {
    if (!('serial' in navigator) && !window.JetApp) $$('#mConnect .opt[data-c$="usb"]').forEach((o) => (o.style.opacity = .45));
    modal('#mConnect', true);
  };
  $('#pGauge').onclick = () => { $('#bSet').click(); };

  /* ---------------- Smart Gauge section (in SETTING) ---------------- */
  function renderGauge() {
    const g = st.gauge;
    const o = st.t && st.t.kind === 'obd' ? st.t : null;
    $('#obdInfo').innerHTML = o ? '🚗 OBD-II: <span class="okc">เชื่อมแล้ว</span> · ' + esc(o.name) + ' · ' + (o.pidList ? o.pidList.length : 0) + ' ค่า · ' + esc(st.veh && st.veh.text ? st.veh.text : o.honda ? 'HONDA PGM-FI (มอเตอร์ไซค์)' : o.fuel === 'd' ? 'ดีเซล' : 'เบนซิน') + (o.ident && o.ident.vin ? '<br><small>VIN ' + esc(o.ident.vin) + (o.ident.cal ? ' · ECU ' + esc(o.ident.cal) : '') + '</small>' : '') : connT ? '🚗 OBD-II: <span class="okc">ต่อ ELM327 แล้ว</span> — รอรถตอบ (เปิดกุญแจ / สตาร์ทเครื่อง) · กด “ตัดการเชื่อมต่อ” เพื่อยกเลิก' : '🚗 OBD-II: ยังไม่เชื่อม';
    $('#gOff').disabled = !g && !o && !connT;
  }
  $('#bSet').addEventListener('click', renderGauge);
  setInterval(() => { if ($('#mSet').classList.contains('show')) renderGauge(); }, 1000);
  const gConnect = async () => { await connectBt('all'); renderGauge(); };
  $('#gBle').onclick = () => gConnect();
  $('#gOff').onclick = async () => {
    if (connT && !st.t) { rcStop = true; await disconnect(); pills(); renderGauge(); toast('ยกเลิกการเชื่อมต่อแล้ว'); return; }      // still waiting for the car
    if (st.t && st.t.kind === 'obd') { rcStop = true; await disconnect(); pills(); renderGauge(); toast('ตัดการเชื่อมต่อ OBD แล้ว'); return; }
    if (!st.gauge) return;
    if (st.gauge === st.t) await disconnect(); else { try { await st.gauge.close(); } catch (e) {} st.gauge = null; st.sens = null; }
    pills(); renderGauge(); toast('ตัดการเชื่อมต่อเกจแล้ว');
  };
  if ($('#bDemo')) $('#bDemo').onclick = () => (st.t && st.t.kind === 'demo') ? disconnect() : connect('demo');
  $$('#mConnect .opt').forEach((o) => o.onclick = () => { modal('#mConnect', false); o.dataset.c === 'obd' ? connectBt('obd') : o.dataset.c === 'gauge-live' ? (window.JetNative ? connectBt('gauge') : connect('gauge-only')) : connect(o.dataset.c); });
  $('#bDisc').onclick = () => { rcStop = true; modal('#mConnect', false); disconnect(); };

  let connAbort = false, connT = null, waitingCar = false;           // a connect that is still waiting for the car / retrying can be cancelled by the user
  async function disconnect() {
    connAbort = true; if (connT) { try { connT.abort(); } catch (e) {} }
    stopLive();
    try { if (st.t) await st.t.close(); } catch (e) {}
    try { if (st.gauge && st.gauge !== st.t) await st.gauge.close(); } catch (e) {}
    st.t = st.gauge = st.ecu = null; st.autoTiles = null; st.veh = null; pills(); renderEcu(); renderTiles(); log('info', 'ตัดการเชื่อมต่อ');
  }
  // find any Bluetooth device (paired + classic + BLE) and connect it by type: Smart Gauge / OBD-II (ELM327 etc.)
  async function connectBt(mode) {
    if (!window.JetLic || !JetLic.ok()) return;
    rcStop = true;                                    // a manual connect replaces any automatic reconnect
    if (!window.JetBt) { return connect(mode === 'obd' ? 'obd' : 'gauge-only'); }
    try {
      toast('เลือกอุปกรณ์ Bluetooth…');
      const dev = await JetBt.btPick(mode);
      if (dev.kind === 'gauge') return connect('gauge-only', dev);
      return connect('obd', dev);
    } catch (e) {
      let m = e.message || String(e);
      if (m === 'ยกเลิก') return;
      const perm = /^PERM:/.test(m), loc = /^LOC:/.test(m); m = m.replace(/^(PERM|LOC):/, '');
      log('err', m); toast(m, 6000);
      if (perm && window.JetNative && JetNative.openAppSettings && await ask(m + '\n\nเปิดหน้าตั้งค่าแอปเลยไหม?', false)) JetNative.openAppSettings();
      else if (loc) { /* message already says to enable Location */ }
    }
  }
  // ---- WiFi OBD2 (ELM327 WiFi adapters): the phone joins the adapter's WiFi, the app talks TCP (usually 192.168.0.10:35000) ----
  let wfBusy = false;
  function wfSetInfo(t) { $('#wfInfo').textContent = t; }
  function wfAdd(label, sub, fn) {
    const b = document.createElement('button');
    b.className = 'btn'; b.style.cssText = 'display:block;width:100%;text-align:left;margin:0 0 8px;white-space:normal';
    b.innerHTML = '<b>' + esc(label) + '</b>' + (sub ? '<br><small>' + esc(sub) + '</small>' : ''); b.onclick = fn; $('#wfList').appendChild(b);
  }
  function wifiUse(host, port, elmOk) {
    modal('#mWifi', false); rcStop = true;
    S.wifiLast = host + ':' + port; saveS();
    if (elmOk === false) toast('ไม่แน่ใจว่าเป็น ELM327 — ลองเชื่อมต่อดู', 3500);
    return connect('obd', { kind: 'obd', name: 'WiFi OBD2', wifi: true, host, port, addr: 'WIFI:' + host + ':' + port });
  }
  function renderWifi(r) {
    const L = $('#wfList'); L.innerHTML = '';
    const devs = (r.devices || []).slice().sort((a, b) => (b.elm ? 1 : 0) - (a.elm ? 1 : 0));
    devs.forEach((d) => wfAdd((d.elm ? '🚗 พบอแดปเตอร์ ELM327' : '❔ มีอุปกรณ์ตอบที่พอร์ตนี้') + ' · ' + d.host + ':' + d.port, d.elm ? 'แตะเพื่อเชื่อมต่อ' : 'ไม่ยืนยันว่าเป็น ELM327 — แตะเพื่อลองเชื่อมต่อ', () => wifiUse(d.host, d.port, d.elm)));
    if (!r.wifiOn) wfSetInfo('WiFi ในมือถือปิดอยู่ — เปิด WiFi แล้วต่อกับ WiFi ของอแดปเตอร์ (ชื่อมักเป็น WiFi_OBDII / OBDII / V-LINK) แล้วกด “ค้นหาใหม่”');
    else if (devs.length) wfSetInfo('WiFi ' + (r.ssid ? '“' + r.ssid + '” ' : '') + '— พบอแดปเตอร์ ' + devs.length + ' ตัว เลือกเพื่อเชื่อมต่อ');
    else if (r.onWifi) wfSetInfo('WiFi ' + (r.ssid ? '“' + r.ssid + '” ' : '') + '— ไม่พบอแดปเตอร์ — ถ้านี่ไม่ใช่ WiFi ของอแดปเตอร์ ให้ต่อ WiFi ของอแดปเตอร์ก่อน (ปิดอแดปเตอร์แล้วเสียบใหม่ถ้าไม่เห็นชื่อ) หรือกด “ใส่ IP เอง”');
    else wfSetInfo('มือถือยังไม่ได้ต่อ WiFi — เลือกชื่อ WiFi ของอแดปเตอร์ด้านล่าง หรือกด “ตั้งค่า WiFi” แล้วต่อเอง');
    const nets = (r.nets || []).slice().sort((a, b) => (b.obd ? 1 : 0) - (a.obd ? 1 : 0) || b.level - a.level);
    if (nets.length && !devs.length) nets.forEach((n) => wfAdd((n.obd ? '🚗 ' : '📶 ') + n.ssid, (n.open ? 'ไม่มีรหัสผ่าน' : 'มีรหัสผ่าน') + ' · ' + n.level + ' dBm · แตะเพื่อต่อ WiFi นี้', () => wifiJoinNet(n)));
    if (r.wifiOn && !r.loc) wfAdd('📍 ยังไม่อนุญาต “ตำแหน่ง” ให้แอป', 'อนุญาตแล้วแอปจะแสดงรายชื่อ WiFi รอบตัวให้เลือก (หรือต่อ WiFi เองในตั้งค่า WiFi) — แตะเพื่อเปิดตั้งค่าแอป', () => { if (window.JetNative && JetNative.openAppSettings) JetNative.openAppSettings(); });
  }
  async function wifiScan() {
    if (!window.JetLic || !JetLic.ok()) return;
    if (!window.JetBt || !JetBt.wifiSearch || !window.JetNative) { toast('ค้นหา WiFi OBD2 ได้เฉพาะในแอป Android'); return; }
    modal('#mWifi', true);
    if (wfBusy) return; wfBusy = true;
    wfSetInfo('กำลังค้นหาอแดปเตอร์…'); $('#wfList').innerHTML = '';
    try { renderWifi(await JetBt.wifiSearch()); }
    catch (e) { wfSetInfo(e.message || String(e)); log('err', e.message || e); }
    finally { wfBusy = false; }
  }
  async function wifiJoinNet(n) {
    let pass = '';
    if (!n.open) { pass = await askText('รหัสผ่านของ WiFi “' + n.ssid + '”', ''); if (pass == null) return; }
    wfBusy = true; wfSetInfo('กำลังต่อ WiFi “' + n.ssid + '” … (ถ้ามีหน้าต่างให้ยืนยัน กด “เชื่อมต่อ/อนุญาต”)'); $('#wfList').innerHTML = '';
    let r; try { r = await JetBt.wifiJoin(n.ssid, pass); } catch (e) { r = { ok: false, err: e.message || String(e) }; }
    wfBusy = false;
    if (!r.ok) { log('err', r.err || 'ต่อ WiFi ไม่สำเร็จ'); toast(r.err || 'ต่อ WiFi ไม่สำเร็จ', 5000); if (r.manual && JetNative.openWifiSettings) JetNative.openWifiSettings(); }
    else log('info', 'ต่อ WiFi ' + n.ssid + ' แล้ว');
    wifiScan();
  }
  async function wifiManual() {
    const v = await askText('ที่อยู่อแดปเตอร์ WiFi (IP:พอร์ต) เช่น 192.168.0.10:35000', S.wifiLast || '192.168.0.10:35000');
    if (v == null) return;
    const m = /^\s*([A-Za-z0-9.\-]+)(?::(\d{1,5}))?\s*$/.exec(v);
    if (!m || +(m[2] || 35000) > 65535) { toast('รูปแบบไม่ถูกต้อง — ตัวอย่าง 192.168.0.10:35000', 4000); return; }
    wifiUse(m[1], +(m[2] || 35000));
  }
  $('#gWifi').onclick = () => wifiScan();
  $('#wfAgain').onclick = () => wifiScan();
  $('#wfManual').onclick = () => wifiManual();
  $('#wfSet').onclick = () => { if (window.JetNative && JetNative.openWifiSettings) JetNative.openWifiSettings(); else toast('ต่อ WiFi ของอแดปเตอร์ในตั้งค่ามือถือ'); };
  // ---- OBD link loss: say why, reconnect by itself, go gentler on an adapter that keeps dropping ----
  let rcBusy = false, rcStop = false;
  const DROP_WIN = 6 * 3600 * 1000;
  const dropsOf = (addr) => ((S.obdDrops || {})[addr] || []).filter((t) => Date.now() - t < DROP_WIN);
  const dropLevel = (addr) => { const n = dropsOf(addr).length; return n >= 3 ? 2 : n >= 2 ? 1 : 0; };               // 0 normal · 1 no count digit / AT2 · 2 one value per request + pauses (expires after 6 h without drops). A single drop is ignored: starting the engine can power-cycle the adapter, that is no sign of a fragile adapter
  const noteDrop = (addr) => { S.obdDrops = S.obdDrops || {}; S.obdDrops[addr] = dropsOf(addr).concat(Date.now()).slice(-5); saveS(); };
  async function reconnectObd(dev) {
    if (rcBusy) return; rcBusy = true; rcStop = false;
    const waits = [1500, 3000, 5000, 8000, 12000, 15000, 15000, 15000, 15000, 15000, 15000];      // ≈ 2 minutes: an adapter that lost power while the engine was cranked needs a few seconds to come back
    try {
      for (let i = 0; i < waits.length && !rcStop; i++) {
        toast('OBD หลุด — กำลังต่อใหม่ ' + (i + 1) + '/' + waits.length, 3000); log('info', 'ต่อ OBD ใหม่ครั้งที่ ' + (i + 1) + '/' + waits.length);
        await P.sleep(waits[i]);
        if (rcStop || st.t) return;                       // the user disconnected on purpose / connected something else meanwhile
        await connect('obd', dev);
        if (st.t && st.t.kind === 'obd') return;          // connected again (LIVE restarts by itself)
      }
      if (!rcStop) { log('err', 'ต่อ OBD ใหม่ไม่สำเร็จ'); toast('ต่อ OBD ใหม่ไม่สำเร็จ — กดเชื่อมต่อเอง', 5000); }
    } finally { rcBusy = false; }
  }
  async function connect(kind, dev) {
    if (!window.JetLic || !JetLic.ok()) return;
    try {
      if (kind === 'obd') {
        if (!window.JetBt) throw new Error('เชื่อม ELM327 ได้เฉพาะในแอป Android');
        if (!dev) { dev = await JetBt.btPick('obd'); }
        await disconnect();
        toast('กำลังเชื่อม ' + (dev.name || 'OBD-II') + '…', 3000);
        connAbort = false;
        // a WiFi adapter serves one client at a time and may still hold the previous connection for a moment: try again a few times
        const openStream = async () => {
          for (let i = 1; ; i++) {
            try { return await JetBt.openObdStream(dev); }
            catch (e) { if (!dev.wifi || i >= 3 || connAbort) throw e; log('warn', 'WiFi ต่อไม่ติด (' + (e.message || e) + ') — ลองใหม่ ' + (i + 1) + '/3'); await P.sleep(1500); }
          }
        };
        let stream = await openStream();
        const lvl = dev.addr ? dropLevel(dev.addr) : 0;
        if (lvl) log('info', 'อแดปเตอร์นี้เคยหลุดภายใน 6 ชม. — ใช้โหมดปลอดภัย ระดับ ' + lvl + ' (ช้าลงเล็กน้อยเพื่อไม่ให้หลุดอีก)');
        const lastProto = dev.addr && !lvl ? ((S.obdProto || {})[dev.addr] || '') : '';
        const mk = (sm) => new Elm327(sm, { name: 'OBD ' + (dev.name || sm.name || 'ELM327'), log, safe: lvl, lastProto });
        let t = mk(stream); connT = t;
        try {
          for (let n = 0; ; n++) {
            try { await t.init(); break; }
            catch (e) {
              if (connAbort) throw new Error('ยกเลิกการเชื่อมต่อ');
              if (t.state === 'NOECU') {                  // the adapter answers, the car does not (key OFF, engine not started yet): stay connected and wait for the car
                log('warn', 'ELM327 ต่อได้แล้ว แต่รถยังไม่ตอบ — รอรถ (เปิดกุญแจ ON / สตาร์ทเครื่อง) · กด ตัดการเชื่อมต่อ เพื่อยกเลิก');
                toast('ต่อ ELM327 แล้ว — รอรถตอบ (เปิดกุญแจ/สตาร์ทเครื่อง)…', 6000);
                let ok = false; const t0 = Date.now();
                while (!connAbort && t.state !== 'OFF' && Date.now() - t0 < 180000) {
                  await P.sleep(1500); if (connAbort) break;
                  if (await t.retryEcu()) { ok = true; break; }
                  if ((Date.now() - t0) % 20000 < 4000) toast('ยังรอรถตอบ… (เปิดกุญแจ/สตาร์ทเครื่อง)', 4000);
                }
                if (connAbort) throw new Error('ยกเลิกการเชื่อมต่อ');
                if (!ok) throw e;
                break;
              }
              if (t.silent && n < 2 && !connAbort) {      // the adapter does not answer at all: a stale connection (WiFi) or an adapter still waking up — reopen the link
                log('warn', 'อแดปเตอร์ไม่ตอบ — เปิดการเชื่อมต่อใหม่ (' + (n + 2) + '/3)');
                try { await stream.close(); } catch (x) {}
                await P.sleep(2000); if (connAbort) throw new Error('ยกเลิกการเชื่อมต่อ');
                stream = await openStream(); t = mk(stream); connT = t; continue;
              }
              throw e;
            }
          }
        } catch (e) { try { await stream.close(); } catch (x) {} throw e; }
        finally { connT = null; }
        if (dev.addr && /^[3-8]$/.test(t.proto) && (S.obdProto || {})[dev.addr] !== t.proto) { S.obdProto = S.obdProto || {}; S.obdProto[dev.addr] = t.proto; saveS(); }      // remembered per adapter for a quick start next time
        t.onLost = (why) => {
          log('err', 'OBD หลุดการเชื่อมต่อ' + (why ? ' — ' + why : '')); stopLive(); st.t = null; st.ecu = null; st.autoTiles = null; pills(); renderTiles();
          if (dev.addr && !rcStop) { noteDrop(dev.addr); reconnectObd(dev); } else toast('OBD หลุดการเชื่อมต่อ');
        };
        st.t = t; st.ecu = t; rcStop = false; pills(); onObdReady(t);
        log('info', 'เชื่อม ' + t.name + (t.ver ? ' · ' + t.ver : '')); toast('เชื่อม OBD-II แล้ว' + (st.veh && st.veh.text ? ' · ' + st.veh.text : '')); startLive();
        return;
      }
      if (kind === 'gauge-only' || kind === 'gauge-only-usb') {
        const via = kind === 'gauge-only-usb' ? 'usb' : 'ble';
        if (via === 'usb' && window.JetApp && st.t && st.t.kind === 'usb') throw new Error('มือถือมีพอร์ต USB เดียว (ใช้กับสาย K-line อยู่) — ต่อเกจด้วย Bluetooth แทน');
        if (st.gauge && st.gauge !== st.t) { try { await st.gauge.close(); } catch (e) {} }
        const g = new GaugeLink(via); if (dev && dev.addr) g.addr = dev.addr; await g.open(); st.gauge = g; g.onLost = () => { if (st.gauge === g) st.gauge = null; if (window.JetGaugeFeed) JetGaugeFeed.lost(g); pills(); toast('เกจหลุดการเชื่อมต่อ'); };
        log('info', 'เชื่อมเกจแล้ว ' + (g.fw || '')); const live = via === 'usb' || /JET SMART GAUGE/i.test(g.fw || '');          // the Smart Gauge screen (any cable); an older gauge over Bluetooth is only for files
        toast(live ? 'เชื่อมจอ Smart Gauge แล้ว — รับค่าจากจอ' : 'เชื่อมเกจแล้ว');
        if (live && window.JetGaugeFeed) JetGaugeFeed.start(g, dev);        // v1.6.10: the screen's own values (rpm, speed, AFR ...) feed the Dash and the AFR LOG
        pills(); return;
      }
      await disconnect();
      let t;
      if (kind === 'demo' && window.SimTransport) t = new SimTransport({ latency: 2 });
      else if (kind === 'usb') { if (!('serial' in navigator) && !window.JetApp) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Serial — ใช้ Chrome/Edge หรือแอป APK'); t = new DirectKLine({ wakeMode: S.wake }); }
      else t = new GaugeLink(kind === 'gauge-usb' ? 'usb' : 'ble');
      await t.open();
      t.onLost = () => { log('err', 'การเชื่อมต่อหลุด'); toast('การเชื่อมต่อหลุด'); st.t = null; if (st.gauge === t) st.gauge = null; pills(); };
      st.t = t; if (kind !== 'usb') st.gauge = t;
      st.ecu = new HondaECU(t, { log, timeout: S.timeout });
      log('info', 'เชื่อมต่อ ' + t.name + (t.fw ? ' · ' + t.fw : ''));
      pills(); await detect();
      if (st.ecu && ['OK', 'SECURE', 'READ'].includes(st.ecu.state)) startLive();
    } catch (e) { log('err', e.message || e); toast(e.message || String(e), 4000); pills(); }
  }

  /* ---------------- busy wrapper ---------------- */
  async function op(name, fn) {
    if (!st.ecu) { toast('ยังไม่ได้เชื่อมต่อ'); modal('#mConnect', true); return; }
    if (st.busy) { toast('กำลังทำงานอื่นอยู่'); return; }
    const wasLive = st.live; stopLive();
    st.busy = true; while (st.liveRunning) await P.sleep(10);
    log('info', '▶ ' + name);
    try { return await fn(); }
    catch (e) { log('err', name + ': ' + (e.message || e)); const x = st.pg; if (x && $('#' + x + 'prog').style.display !== 'none') { $('#' + x + 'pStage').innerHTML = '<span class="badc">✗ ' + esc(e.message || e) + '</span>'; $('#' + x + 'bCancel').style.display = 'none'; } toast(e.cancelled ? 'ยกเลิกแล้ว' : (e.message || String(e)), 5000); }
    finally { st.busy = false; pills(); renderStats(); if (wasLive) startLive(); }
  }

  /* ---------------- ECU info / live ---------------- */
  async function detect() {
    return op('ตรวจกล่อง', async () => {
      const s = await st.ecu.detect();
      log('info', 'สถานะกล่อง: ' + s + ' — ' + P.STATE_TH[s]);
      if (s === 'OK') { st.fcount = await st.ecu.flashCount(); }
      renderEcu(); return s;
    });
  }
  function renderEcu() {}
  // segmented RPM bar: green → yellow → orange → red
  const NSEG = 48, SEG = [];
  (function () {
    const g = $('#arcSeg'), R = 118, NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < NSEG; i++) {
      const a0 = (135 + 270 * i / NSEG + 0.7) * Math.PI / 180, a1 = (135 + 270 * (i + 1) / NSEG - 0.7) * Math.PI / 180;
      const pt = (a) => (150 + R * Math.cos(a)).toFixed(2) + ' ' + (150 + R * Math.sin(a)).toFixed(2);
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', `M ${pt(a0)} A ${R} ${R} 0 0 1 ${pt(a1)}`);
      p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', '17'); p.setAttribute('stroke-linecap', 'butt');
      p.setAttribute('stroke', '#11264a');
      g.appendChild(p); SEG.push(p);
    }
  })();
  let lastN = -1, lastOn = -1, lastHot = false;
  // colours: the red zone starts at the redline of the chosen bike (Setup); no redline = the old fixed 60 % mark
  function arcColors() {
    const rl = S.redline > 0 && S.rpmMax > 0 ? Math.min(1, S.redline / S.rpmMax) : 0.8;
    SEG.forEach((p, i) => {
      const f = Math.min(1, (i / (NSEG - 1)) / rl), hue = f < 0.6 ? 140 - (85 * f / 0.6) : 55 - 55 * (f - 0.6) / 0.4;
      p.dataset.c = `hsl(${Math.round(hue)},92%,${f > 0.6 ? 55 : 52}%)`;
    });
    lastN = -1; lastOn = -1;
  }
  arcColors();
  window.addEventListener('jetvehicle', arcColors);
  function rpmArc(p) {
    const n = Math.round(p * NSEG); if (n === lastN) return; lastN = n;
    const prev = lastOn; lastOn = n; const a = Math.min(prev, n), b = Math.max(prev, n); if (prev < 0) { SEG.forEach((e, i) => e.setAttribute('stroke', i < n ? e.dataset.c : '#11264a')); return; }
    for (let i = a; i < b; i++) SEG[i].setAttribute('stroke', i < n ? SEG[i].dataset.c : '#11264a');
  }
  const ARC_LEN = 2 * Math.PI * 118 * 0.75;
  /* ---- every value the app can show (Dash tiles / GRID cells) ---- */
  const CH = {
    RPM: { l: 'RPM', u: 'rpm', d: 0, bar: [0, 12000], grad: 1 }, SPD: { l: 'Speed', u: 'km/h', d: 0 }, TPS: { l: 'Throttle', u: '%', d: 1, col: '#4d8dff', bar: [0, 100] },
    ECT: { l: 'Coolant', u: '°C', d: 0 }, IAT: { l: 'Intake', u: '°C', d: 0 }, MAP: { l: 'MAP', u: 'kPa', d: 0 }, BATT: { l: 'Battery', u: 'V', d: 1, col: '#ff5a6a' },
    INJ: { l: 'Injector', u: 'ms', d: 2 }, IGN: { l: 'Ignition', u: '°', d: 1 }, AFR: { l: 'AFR', u: '', d: 1, col: '#2fd18b', bar: [10, 18] },
    CRP: { l: 'CRP volt', u: 'V', d: 2, col: '#ffc233', bar: [0, 5] }, EOT: { l: 'Oil temp', u: '°C', d: 0 }, O2: { l: 'O2', u: 'V', d: 2 }, GEAR: { l: 'Gear', u: '', d: 0 },
  };
  P.OBD.forEach(([k, en, th, u, dec]) => { if (!CH[k]) CH[k] = { l: en, th, u, d: dec }; });          // all OBD-II channels are selectable as tiles
  const chLab = (c) => c.l;                                     // short English tile labels (same as the original tiles)
  const chVal = (d, k) => (k === 'SPD' ? (d.SPD != null ? d.SPD : d.GPS) : d[k]);
  const chText = (d, k) => {
    const v = chVal(d || {}, k), c = CH[k]; if (v == null) return '--';
    return k === 'GEAR' ? (v === 0 ? 'N' : String(v)) : (+v).toFixed(c.d);
  };
  const DEF_RATIOS = '140 92 68 54 45 38';
  const DEF_TILES = ['ECT', 'IAT', 'MAP', 'BATT', 'INJ', 'IGN'];
  function pick(title, cur, cb, avail) {
    $('#pkTitle').textContent = title;
    const all = Object.keys(CH), ks = avail ? all.filter((k) => avail.has(k) || k === cur).concat(all.filter((k) => !avail.has(k) && k !== cur)) : all;
    $('#pkGrid').innerHTML = ks.map((k) => `<button class="${k === cur ? 'on' : ''}${avail && !avail.has(k) && k !== cur ? ' na' : ''}" data-k="${k}"><b>${chLab(CH[k])}</b><small>${CH[k].u || '&nbsp;'}</small></button>`).join('');
    $$('#pkGrid button').forEach((b) => b.onclick = () => { modal('#mPick', false); cb(b.dataset.k); });
    modal('#mPick', true);
  }
  // ---- the 6 Dash tiles follow the car: petrol / diesel pick different values, only ones the car really reports (same logic as the CAR gauge's autoSlots) ----
  const PRI = {
    g: [['ECT'], ['EOT', 'STFT1', 'MAP', 'LTFT1'], ['LOAD', 'APPD', 'MAF'], ['IAT', 'AMB'], ['BATT'], ['AFR', 'LAMB', 'MAP', 'IGN']],
    d: [['ECT'], ['EOT', 'CACT', 'MAP'], ['LOAD', 'TQA', 'APPD'], ['EGT1', 'FRP', 'IAT', 'AMB'], ['BATT'], ['BOOST', 'FRP', 'MAP', 'CACT']],
    b: [['ECT'], ['IAT'], ['MAP'], ['BATT'], ['INJ'], ['IGN']],
  };
  function autoTiles(keys, prof) {
    const pri = PRI[prof] || PRI.g, used = new Set(), out = new Array(6).fill(null);
    [0, 3, 1, 4, 2, 5].forEach((i) => { const k = pri[i].find((x) => keys.has(x) && !used.has(x)); if (k) { out[i] = k; used.add(k); } });
    const rest = Object.keys(CH).filter((k) => keys.has(k) && !used.has(k) && !['RPM', 'SPD', 'TPS', 'GEAR', 'CRP', 'O2'].includes(k));
    return out.map((k, i) => k || rest.shift() || DEF_TILES[i]);
  }
  const isBike = (t) => !!(t && (t.honda || (st.veh && st.veh.bike)));
  const profile = () => (st.t && st.t.kind === 'obd' ? (isBike(st.t) ? 'b' : st.t.fuel === 'd' ? 'd' : 'g') : 'b');
  function tilesNow() {
    const pf = profile(), c = S.tilesBy && S.tilesBy[pf];
    if (Array.isArray(c) && c.length === 6) return c;
    if (st.autoTiles) return st.autoTiles;
    return pf === 'b' && Array.isArray(S.tiles) && S.tiles.length === 6 ? S.tiles : DEF_TILES;
  }
  function renderTiles(d) {
    d = d || st.last || {};
    const t = tilesNow();
    $$('.tile[data-s]').forEach((el) => {
      const k = t[+el.dataset.s], c = CH[k] || CH.ECT;
      el.querySelector('.k').textContent = chLab(c); el.querySelector('b').textContent = chText(d, k); el.querySelector('small').textContent = c.u;
    });
  }
  $$('.tile[data-s]').forEach((el) => el.onclick = () => {
    const t = tilesNow().slice(), i = +el.dataset.s, pf = profile();
    pick('เลือกค่าที่ช่องนี้', t[i], (k) => { t[i] = k; S.tilesBy = S.tilesBy || {}; S.tilesBy[pf] = t; if (pf === 'b') S.tiles = t; saveS(); renderTiles(); }, st.t && st.t.kind === 'obd' ? st.t.channelKeys() : null);
  });
  window.addEventListener('jetlang', () => renderTiles());
  function resetTiles() { const pf = profile(); if (S.tilesBy) delete S.tilesBy[pf]; if (pf === 'b') S.tiles = null; saveS(); renderTiles(); }
  // after an OBD connection: identify the car, choose the tiles, poll the chosen channels fast
  function onObdReady(t) {
    try { P.vehOnObd(t); } catch (e) { log('err', 'ระบุรุ่นรถไม่สำเร็จ: ' + e.message); }
    const keys = t.channelKeys(), pf = isBike(t) ? 'b' : t.fuel === 'd' ? 'd' : 'g';
    st.autoTiles = autoTiles(keys, pf);
    t.afrPref = S.afrSrc || 'auto';
    t.watch(st.autoTiles.concat(['LAMB', 'EQR', 'O2', 'STFT1', 'LTFT1']));
    log('info', 'ช่องหน้าหลักอัตโนมัติ (' + (pf === 'd' ? 'ดีเซล' : pf === 'b' ? 'มอเตอร์ไซค์ Honda' : 'เบนซิน') + '): ' + st.autoTiles.join(', '));
    renderTiles();
  }
  // centre of the round gauge: tap to cycle km/h → AFR → CRP volt
  const CENTER = { spd: ['SPD', 'km/h ⇄', 0], afr: ['AFR', 'AFR ⇄', 1], crp: ['CRP', 'CRP volt ⇄', 2] };
  const NEXT = { spd: 'afr', afr: 'crp', crp: 'spd' };
  function showCenter(d) {
    d = d || st.last || {};
    const m = CENTER[S.center] ? S.center : 'spd', [key, unit, dec] = CENTER[m], el = $('#vSPD');
    const v = m === 'spd' ? (d.SPD != null ? d.SPD : d.GPS) : d[key];
    if (v != null) el.textContent = m === 'spd' ? Math.round(v) : (+v).toFixed(dec);
    else el.textContent = m === 'spd' ? '0' : '--';
    el.style.color = m !== 'afr' || v == null ? '' : v < 11.5 ? '#ff6b7a' : v > 15.5 ? '#ffb020' : '#7dffb8';
    $('#vUnit').textContent = m === 'afr' && d.afrSrc === 'cmd' ? 'AFR (ECU สั่ง) ⇄' : m === 'afr' && d.afrSrc === 'o2' ? 'AFR (O2 ประมาณ) ⇄' : unit;
    const g = d.GEAR; $('#vGear').textContent = g == null ? '–' : g === 0 ? 'N' : g;
  }
  $('.gauge').addEventListener('click', () => {
    S.center = NEXT[CENTER[S.center] ? S.center : 'spd']; saveS(); showCenter();
    const need = { afr: ['AFR', st.t && st.t.kind === 'obd' ? 'รถคันนี้ไม่ส่งค่า Lambda/AFR ทาง OBD-II — ต่อ Smart Gauge ที่มีไวด์แบนด์เพิ่มได้' : 'ยังไม่มีค่า AFR — ต้องต่อ Smart Gauge ที่มีไวด์แบนด์'], crp: ['CRP', 'ยังไม่มีค่า CRP — ต้องต่อ Smart Gauge ที่มีเซ็นเซอร์ CRP (หรือเปิด DEMO)'] }[S.center];
    if (need && (!st.last || st.last[need[0]] == null)) toast(need[1], 3500);
  });
  function showLive(d) {
    showCenter(d); renderTiles(d);
    const tp = $('#vTPS'); if (tp && d.TPS != null) tp.textContent = (+d.TPS).toFixed(1);
    if (d.RPM != null) {
      $('#vRPM').textContent = Math.round(d.RPM).toLocaleString('en-US');
      rpmArc(Math.max(0, Math.min(1, d.RPM / (S.rpmMax || 12000))));
      const hot = S.redline > 0 && d.RPM >= S.redline * 0.95;          // shift light: RPM text blinks red near the redline
      if (hot !== lastHot) { lastHot = hot; $('#vRPM').parentNode.classList.toggle('shift', hot); }
    } else if (lastHot) { lastHot = false; $('#vRPM').parentNode.classList.remove('shift'); }
    if (d.TPS != null) $('#tpsBar').style.width = Math.max(0, Math.min(100, d.TPS)) + '%';
  }
  // merge gauge sensors (AFR wideband / GPS / EOT / O2) and phone GPS into a live sample
  let sensLoopOn = false;
  async function sensLoop() {          // gauge sensors polled independently: the K-line/OBD read never waits for them
    if (sensLoopOn) return; sensLoopOn = true;
    try { while (st.live && st.gauge && st.gauge.sensors && !st.gauge.noSensors) { try { const s = await st.gauge.sensors(); if (s) st.sens = s; else await P.sleep(30); } catch (e) { await P.sleep(100); } } }
    finally { sensLoopOn = false; }
  }
  async function mergeSensors(d) {
    const s = st.sens;
    if (s && st.gauge && Date.now() - s.t < 1500) {
      if (s.afrOk) d.AFR = s.afr; if (s.eotOk) d.EOT = s.eot; if (s.o2Ok) d.O2 = s.o2; if (s.crpOk) d.CRP = s.crp; if (s.gearOk) d.GEAR = s.gear; if (s.obd) Object.assign(d, s.obd);
      const gk = d.gk || (d.gk = {}); if (s.afrOk) gk.AFR = 1; if (s.eotOk) gk.EOT = 1; if (s.o2Ok) gk.O2 = 1; if (s.crpOk) gk.CRP = 1;      // from the screen: never sent back to it
    }
    const g = window.JetGps && JetGps.current();
    if (g) { d.GPS = g.spd; d.gpsSrc = g.src; }
    if (d.GEAR == null && !S.cvt) {
      const sp = d.SPD != null ? d.SPD : d.GPS, g = P.computeGear(d.RPM, sp, P.parseRatios(S.gearRatios || DEF_RATIOS));
      if (g != null) d.GEAR = g;
    }
    if (window.JetGaugeFeed) JetGaugeFeed.fill(d);                    // v1.6.10: values the OBD / K-line sample lacks come from the Smart Gauge screen (LIVE)
    d.t = Date.now();
    (window.JetDeriveHooks || []).forEach((f) => { try { f(d); } catch (e) { console.error(e); } });
    return d;
  }
  function emitLive(d) { (window.JetHooks || []).forEach((f) => { try { f(d); } catch (e) { console.error(e); } }); }
  // no fresh data for a while: is it the adapter (link frozen → reconnect) or the car (key off / ECU asleep → stop)?
  async function liveStalled() {
    const t = st.t; let alive = true;
    try { alive = !(t && t.alive) || await t.alive(); } catch (e) { alive = false; }
    if (!alive && t && t.kind === 'obd' && t.onLost) { try { await t.s.close(); } catch (e) {} t.state = 'OFF'; t.onLost('อแดปเตอร์หยุดตอบ (ลิงก์ยังอยู่แต่ไม่มีคำตอบเกิน ' + Math.round((t.deadMs || 8000) / 1000) + ' วินาที)'); return; }
    if (t && t.kind === 'obd' && t.recover && !t.dead && t.state !== 'OFF') { waitCar(t); return; }      // the adapter answers, the car does not: wait for the car (key ON / engine start) instead of giving up
    log('err', 'LIVE: กล่องไม่ตอบ' + (t && t.kind === 'obd' ? ' — อแดปเตอร์ยังตอบ แต่รถไม่ส่งค่า (เปิดกุญแจ ON อยู่หรือไม่?)' : '')); stopLive();
  }
  // key OFF, engine cranking (the voltage dip resets cheap adapters) or an ECU that went to sleep: keep the link, put the adapter back in a known state and ask again until the car answers — LIVE restarts by itself
  async function waitCar(t) {
    if (waitingCar) return; waitingCar = true; stopLive();
    log('warn', 'LIVE: รถไม่ส่งค่า (กุญแจดับ / กำลังสตาร์ท) — รอรถตอบแล้วอ่านต่อเอง · กด ตัดการเชื่อมต่อ เพื่อหยุดรอ');
    toast('รถไม่ส่งค่า — รอรถตอบ แล้วอ่านต่ออัตโนมัติ', 5000);
    try {
      const t0 = Date.now();
      while (st.t === t && t.state !== 'OFF' && !t.dead && Date.now() - t0 < 600000) {
        pills();
        if (await t.recover()) { pills(); log('info', 'รถตอบแล้ว — อ่านค่าต่อ'); toast('รถตอบแล้ว — อ่านค่าต่อ'); startLive(); return; }
        pills(); await P.sleep(2000);
      }
      if (st.t === t && t.state !== 'OFF') log('err', 'LIVE: รอรถตอบนานเกิน 10 นาที — หยุดรอ');
    } finally { waitingCar = false; pills(); }
  }
  async function liveLoop() {
    st.liveRunning = true;
    let fails = 0; sensLoop();
    while (st.live && st.ecu && !st.busy) {
      try {
        const d = await st.ecu.readLive();
        if (d) { fails = 0; await mergeSensors(d); showLive(d); emitLive(d); } else if (++fails > 3) { await liveStalled(); break; }
      } catch (e) { stopLive(); }
      await Promise.resolve();   // no artificial pause: next request goes out as soon as the answer is in
    }
    st.liveRunning = false;
  }
  function startLive() { if (!st.ecu || st.live || !window.JetLic || !JetLic.ok()) return; st.live = true; $('#bLive').textContent = '■ STOP'; $('#bLive').classList.add('on'); liveLoop(); }
  function stopLive() { st.live = false; $('#bLive').textContent = '▶ LIVE'; $('#bLive').classList.remove('on'); }
  $('#bLive').onclick = () => { if (!st.ecu) return toast(window.JetGaugeFeed && JetGaugeFeed.active() ? 'กำลังรับค่าสดจากจอ Smart Gauge อยู่แล้ว' : 'ยังไม่ได้เชื่อมต่อ'); st.live ? stopLive() : startLive(); };
  /* ---------------- DTC ---------------- */
  const dtcHtml = (l) => l.length ? l.map((k) => `<div class="dtc"><b>${k}</b><span>${esc(P.dtcText(k))}</span></div>`).join('') : '<div class="okc">ไม่มีโค้ด ✔</div>';
  const showDtc = (r) => { $('#dtcCur').innerHTML = dtcHtml(r.current); $('#dtcPast').innerHTML = dtcHtml(r.past); };
  const logDtcRaw = () => { const d = st.ecu && st.ecu.dtcRaw; if (d) log('info', 'DTC ที่ ECU ตอบ: ' + Object.keys(d).map((k) => k + ' → ' + (d[k] || '(ว่าง)')).join(' · ')); };      // raw answers in the log: what to send when a code looks wrong
  $('#bDtc').onclick = () => op('อ่านโค้ด DTC', async () => { const r = await st.ecu.readDTC(); showDtc(r); logDtcRaw(); });
  $('#bDtcClr').onclick = async () => {
    if (!(await ask('ลบโค้ดทั้งหมดในกล่อง?', true))) return;
    op('ลบโค้ด', async () => {
      const ok = await st.ecu.clearDTC(), info = st.ecu.clearInfo || null;
      if (info) log(ok ? 'info' : 'err', 'ลบโค้ด: ECU ตอบ ' + (info.raw || '(ไม่มีคำตอบ)'));
      await P.sleep(800);                                                    // the ECU needs a moment before it reports the new state
      const r = await st.ecu.readDTC(); showDtc(r); logDtcRaw();
      const left = Array.from(new Set(r.current.concat(r.past)));
      if (!ok) toast((info && info.why) || 'ลบไม่สำเร็จ', 6000);
      else if (left.length) toast('ECU รับคำสั่งลบแล้ว แต่ยังเห็นโค้ด ' + left.join(', ') + ' — อาจเป็นเพราะปัญหายังอยู่ (ECU ตั้งโค้ดกลับทันที) แก้เซ็นเซอร์/สายไฟแล้วลบอีกครั้ง', 8000);
      else toast('ลบโค้ดแล้ว ✔');
    });
  };

  /* ---------------- file library (IndexedDB) ---------------- */
  const DB = {
    db: null,
    open() { return new Promise((res, rej) => { const r = indexedDB.open('mfbk', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' }); r.onsuccess = () => res((this.db = r.result)); r.onerror = () => rej(r.error); }); },
    tx(m) { return this.db.transaction('files', m).objectStore('files'); },
    all() { return new Promise((res) => { const r = this.tx('readonly').getAll(); r.onsuccess = () => res(r.result.sort((a, b) => b.date - a.date)); r.onerror = () => res([]); }); },
    put(f) { return new Promise((res) => { const r = this.tx('readwrite').put(f); r.onsuccess = () => res(f); }); },
    del(id) { return new Promise((res) => { const r = this.tx('readwrite').delete(id); r.onsuccess = res; }); },
  };
  async function addFile(name, u8, meta) {
    const f = Object.assign({ id: Date.now() + '' + Math.random().toString(36).slice(2, 6), name, date: Date.now(), data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.length) }, meta || {});
    await DB.put(f); await refreshFiles(); selectFile(f.id); return f;
  }
  const fbytes = (f) => new Uint8Array(f.data);
  async function refreshFiles() {
    st.files = await DB.all();
    const opts = '<option value="">—</option>' + st.files.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
    const a = $('#hxA').value, b = $('#hxB').value; $('#hxA').innerHTML = opts; $('#hxB').innerHTML = opts; $('#hxA').value = a; $('#hxB').value = b;
    (window.JetFileHooks || []).forEach((f) => { try { f(st.files); } catch (e) { console.error(e); } });
  }
  const layout = (f) => P.detectLayout(fbytes(f), f);
  function selectFile(id) {
    st.sel = st.files.find((f) => f.id === id) || null;
    if (st.sel && !$('#hxA').value) $('#hxA').value = id;
  }

  /* ---------------- EEPROM ---------------- */
  const hexDump = (u, base, cmp) => {
    let s = '';
    for (let o = 0; o < u.length; o += 16) {
      s += `<span class="a">${(base + o).toString(16).toUpperCase().padStart(6, '0')}</span>  `;
      let asc = '';
      for (let i = 0; i < 16 && o + i < u.length; i++) {
        const b = u[o + i], h = b.toString(16).toUpperCase().padStart(2, '0');
        const diff = cmp && cmp[o + i] !== undefined && cmp[o + i] !== b;
        s += diff ? `<span class="d">${h}</span> ` : b === 0xFF || b === 0 ? `<span class="z">${h}</span> ` : h + ' ';
        asc += b > 31 && b < 127 ? esc(String.fromCharCode(b)) : '.';
        if (i === 7) s += ' ';
      }
      s += ' ' + asc + '\n';
    }
    return s;
  };
  const showEe = () => { $('#eeHex').innerHTML = st.ee ? hexDump(st.ee, 0) : 'ยังไม่มีข้อมูล'; };
  $('#bEeR').onclick = () => op('อ่าน EEPROM', async () => { st.ee = await st.ecu.eepromRead(); showEe(); toast('อ่าน EEPROM ' + st.ee.length + ' byte'); });
  $('#bEeSave').onclick = () => { if (!st.ee) return toast('ยังไม่มีข้อมูล'); download('EEPROM_' + Date.now() + '.bin', st.ee); };
  $('#bEeW').onclick = () => $('#fEe').click();
  $('#fEe').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const u = new Uint8Array(await f.arrayBuffer());
    if (u.length !== 256 && u.length !== 512) return toast('ไฟล์ EEPROM ต้อง 256 หรือ 512 byte');
    if (!(await ask('เขียน EEPROM จากไฟล์ ' + f.name + ' ?', true))) return;
    op('เขียน EEPROM', async () => { await st.ecu.eepromWrite(u); toast('เขียน EEPROM สำเร็จ'); st.ee = u; showEe(); });
  };
  const fmt = async (ff) => { if (await ask('ฟอร์แมต EEPROM เป็น ' + (ff ? 'FF' : '00') + ' ? ข้อมูลเดิมจะหายทั้งหมด', true)) op('ฟอร์แมต EEPROM', async () => toast((await st.ecu.eepromFormat(ff)) ? 'ฟอร์แมตแล้ว' : 'ไม่สำเร็จ')); };
  $('#bEeFF').onclick = () => fmt(true); $('#bEe00').onclick = () => fmt(false);

  /* ---------------- HEX / COMPARE ---------------- */
  const ROWS = 64;
  function renderHex() {
    const A = st.files.find((f) => f.id === $('#hxA').value), B = st.files.find((f) => f.id === $('#hxB').value);
    if (!A) { $('#hx').textContent = 'เลือกไฟล์ A'; $('#hxSum').textContent = ''; return; }
    const a = fbytes(A), b = B ? fbytes(B) : null;
    st.hexOff = Math.max(0, Math.min(st.hexOff, Math.max(0, a.length - 16))) & ~15;
    const view = a.subarray(st.hexOff, st.hexOff + ROWS * 16);
    $('#hx').innerHTML = hexDump(view, st.hexOff, b ? b.subarray(st.hexOff, st.hexOff + ROWS * 16) : null);
    $('#hxGo').value = st.hexOff.toString(16).toUpperCase();
    if (b) {
      let n = 0, ranges = 0, prev = false;
      const L = Math.min(a.length, b.length);
      for (let i = 0; i < L; i++) { const d = a[i] !== b[i]; if (d) { n++; if (!prev) ranges++; } prev = d; }
      $('#hxSum').innerHTML = `ต่างกัน <b class="warn">${n}</b> byte ใน <b>${ranges}</b> ช่วง` + (a.length !== b.length ? ` · <span class="badc">ขนาดไม่เท่ากัน (${a.length} / ${b.length})</span>` : '');
    } else $('#hxSum').textContent = `${A.name} · ${kb(a.length)}`;
  }
  $('#hxA').onchange = $('#hxB').onchange = () => { st.hexOff = 0; renderHex(); };
  $('#hxGo').onchange = () => { st.hexOff = parseHex($('#hxGo').value); renderHex(); };
  $('#hxPrev').onclick = () => { st.hexOff -= ROWS * 16; renderHex(); };
  $('#hxNext').onclick = () => { st.hexOff += ROWS * 16; renderHex(); };
  $('#hxDiff').onclick = () => {
    const A = st.files.find((f) => f.id === $('#hxA').value), B = st.files.find((f) => f.id === $('#hxB').value);
    if (!A || !B) return toast('เลือกไฟล์ A และ B');
    const a = fbytes(A), b = fbytes(B), L = Math.min(a.length, b.length);
    let i = st.hexOff + ROWS * 16; while (i < L && a[i] === b[i]) i++;
    if (i >= L) { i = 0; while (i < L && a[i] === b[i]) i++; }
    if (i >= L) return toast('ไม่มีจุดต่าง');
    st.hexOff = Math.max(0, (i & ~15) - 64); renderHex();
  };

  /* ---------------- settings ---------------- */
  $('#bSet').onclick = () => {
    modal('#mSet', true);
  };
  $('#sSave').onclick = () => {
    try {
      saveS();
      modal('#mSet', false); toast('บันทึกแล้ว');
    } catch (e) { toast('ผิดพลาด: ' + e.message, 4000); }
  };
  $('#sReset').onclick = async () => { if (await ask('คืนค่าตั้งค่าทั้งหมด?', true)) { localStorage.removeItem(LS); location.reload(); } };

  function renderStats() { if (st.ecu) $('#stats').textContent = `TX ${st.ecu.stats.tx} · RX ${st.ecu.stats.rx} · retry ${st.ecu.stats.retry} · bad ${st.ecu.stats.bad}`; }
  setInterval(renderStats, 1500);

  window.JetBack = () => {
    const m = document.querySelector('.modal.show'); if (m) { if (m.id === 'mDlg') $('#dNo').click(); else m.classList.remove('show'); return true; }
    if (!pages[0].classList.contains('show')) { go(0); return true; }
    return false;
  };

  /* ---------------- API for ui-extra.js ---------------- */
  window.JetCore = { resetTiles, tilesNow, CH, chText, chVal, pick, DEF_RATIOS, renderTiles, st, S, saveS, $, $$, P, toast, ask, askText, dlg, op, go, pageOf, fbytes, addFile, refreshFiles, log, esc, kb, download, modal,
    startLive, stopLive, renderHex, mergeSensors, emitLive, models, parseHex, connect, connectBt, showLive, pills };

  /* ---------------- boot ---------------- */
  (async () => {
    const t0 = Date.now();
    const sp = (pct, msg) => { $('#spBar').style.width = pct + '%'; if (msg) $('#spMsg').textContent = msg; };
    const hideSplash = () => { const el = $('#splash'); if (!el || el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), 600); };
    setTimeout(hideSplash, 6000); // fail-safe
    sp(15, 'โหลดธีมและหน้าจอ…');
    applyTheme(); applyLogo(); go(0); pills(); renderEcu(); showCenter(); renderTiles();
    sp(45, 'เปิดคลังไฟล์ ECU…');
    try { await DB.open(); await refreshFiles(); } catch (e) { toast('เปิดคลังไฟล์ไม่ได้: ' + e.message); }
    sp(75, 'เตรียมโปรโตคอล K-LINE…');
    await P.sleep(250);
    sp(100, window.JetApp ? 'พร้อม · USB OTG + Bluetooth' : 'พร้อมใช้งาน');
    await P.sleep(Math.max(300, 1900 - (Date.now() - t0)));
    hideSplash();
    log('info', window.JetApp ? 'Jet Smart Gauge (Android APP) พร้อมใช้งาน · USB OTG + Bluetooth' : 'Jet Smart Gauge พร้อมใช้งาน · Web Serial: ' + ('serial' in navigator ? 'มี' : 'ไม่มี') + ' · Bluetooth: ' + ('bluetooth' in navigator ? 'มี' : 'ไม่มี'));
  })();
})();
