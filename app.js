/* =====================================================================
 * Jet_HONDA Tune — app.js (UI)
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
    $('#dLink').className = 'dot' + (t ? ' on' : '');
    $('#tLink').textContent = t ? t.name : 'OFFLINE · แตะเพื่อเชื่อมต่อ';
    const s = st.ecu ? st.ecu.state : null;
    const good = s === 'OK' || s === 'SECURE' || s === 'READ';
    $('#tEcu').className = 'chipst' + (good ? ' on' : s && s !== 'OFF' ? ' mid' : '');
    $('#tEcu').textContent = 'ECU ' + (s || '—');
    $('#pGauge').className = 'chipst' + (st.gauge ? ' on' : '');
    $('#tGauge').textContent = st.gauge ? 'GAUGE ✓' : 'GAUGE';
    $('#bDemo').classList.toggle('on', !!(t && t.kind === 'demo'));
  }

  /* ---------------- connect ---------------- */
  $('#bConnect').onclick = () => {
    if (!('serial' in navigator) && !window.JetApp) $$('#mConnect .opt[data-c$="usb"]').forEach((o) => (o.style.opacity = .45));
    modal('#mConnect', true);
  };
  $('#pGauge').onclick = () => { $('#bSet').click(); };

  /* ---------------- Smart Gauge section (in SETTING) ---------------- */
  function renderGauge() {
    const g = st.gauge, s = st.sens, fresh = s && Date.now() - s.t < 3000, ok = (b) => (b ? '<span class="okc">✓</span>' : '<span class="mut">✗</span>');
    const via = !g ? '—' : g.kind === 'demo' ? 'DEMO (จำลอง)' : g.via === 'usb' ? 'สาย USB' : 'Bluetooth';
    $('#gInfo').innerHTML = [
      ['สถานะ', g ? '<span class="okc">เชื่อมแล้ว</span>' : '<span class="badc">ยังไม่เชื่อม</span>'], ['ชื่อ', g ? esc(g.name || '') : '—'],
      ['ช่องทาง', via], ['เฟิร์มแวร์', g ? esc(g.fw || '—') : '—'],
      ['เป็นตัวต่อ K-line', g && st.t === g ? '<span class="okc">ใช่</span>' : 'ไม่'], ['เซ็นเซอร์', g ? (fresh ? `AFR ${ok(s.afrOk)} GPS ${ok(s.gpsOk)}${s.gpsOk ? ' (' + s.sats + ')' : ''} EOT ${ok(s.eotOk)} O2 ${ok(s.o2Ok)}` : g.noSensors ? 'เฟิร์มแวร์ไม่รองรับ' : 'รอข้อมูล…') : '—'],
    ].map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    $('#gKl').checked = S.gaugeKl != null ? !!S.gaugeKl : !!(g && st.t === g);
    $('#gOff').disabled = !g;
  }
  $('#bSet').addEventListener('click', renderGauge);
  setInterval(() => { if ($('#mSet').classList.contains('show')) renderGauge(); }, 1000);
  $('#gKl').onchange = () => { S.gaugeKl = $('#gKl').checked; saveS(); };
  const gConnect = async (via) => {
    const kl = $('#gKl').checked;
    if (kl && st.t && st.t.kind === 'usb' && !(await ask('ตอนนี้ต่อสาย K-line USB อยู่ — เปลี่ยนไปใช้เกจเป็นตัวต่อ K-line แทน?'))) return;
    await connect(kl ? (via === 'usb' ? 'gauge-usb' : 'gauge-ble') : (via === 'usb' ? 'gauge-only-usb' : 'gauge-only'));
    renderGauge();
  };
  $('#gBle').onclick = () => gConnect('ble');
  $('#gUsb').onclick = () => gConnect('usb');
  $('#gOff').onclick = async () => {
    if (!st.gauge) return;
    if (st.gauge === st.t) await disconnect(); else { try { await st.gauge.close(); } catch (e) {} st.gauge = null; st.sens = null; }
    pills(); renderGauge(); toast('ตัดการเชื่อมต่อเกจแล้ว');
  };
  $('#gTest').onclick = async () => {
    const g = st.gauge; if (!g) return toast('ยังไม่ได้เชื่อมเกจ');
    if (st.busy) return toast('กำลังทำงานอื่นอยู่');
    const t0 = performance.now();
    const pong = g.request ? await g.request(P.LINK.PING, [], 2000) : true;
    const rtt = Math.round(performance.now() - t0);
    const s = g.sensors ? await g.sensors() : null; if (s) st.sens = s;
    renderGauge();
    toast(pong ? `เกจตอบกลับใน ${rtt} ms · ` + (s ? `AFR ${s.afrOk ? s.afr.toFixed(1) : '✗'} · GPS ${s.gpsOk ? Math.round(s.spd) + ' km/h' : '✗'}` : 'ยังไม่รองรับคำสั่งเซ็นเซอร์') : 'เกจไม่ตอบ — ตรวจเฟิร์มแวร์ / ระยะ Bluetooth', 4500);
  };
  $('#gList').onclick = async () => {
    const g = st.gauge; if (!g) return toast('ยังไม่ได้เชื่อมเกจ');
    const box = $('#gFiles'); box.style.display = 'block'; box.textContent = 'กำลังอ่าน…';
    const list = g.fileList ? await g.fileList() : (g.files || []).map((f) => ({ name: '/ecu/' + f.name + '.bin', size: f.size }));
    box.textContent = !list ? 'อ่านรายการไฟล์ไม่ได้' : list.length ? list.map((f) => `${f.name}  ${(f.size / 1024).toFixed(1)} KB`).join('\n') : 'ยังไม่มีไฟล์ในเกจ';
  };
  $('#bDemo').onclick = () => (st.t && st.t.kind === 'demo') ? disconnect() : connect('demo');
  $$('#mConnect .opt').forEach((o) => o.onclick = () => { modal('#mConnect', false); connect(o.dataset.c); });
  $('#bDisc').onclick = () => { modal('#mConnect', false); disconnect(); };

  async function disconnect() {
    stopLive();
    try { if (st.t) await st.t.close(); } catch (e) {}
    try { if (st.gauge && st.gauge !== st.t) await st.gauge.close(); } catch (e) {}
    st.t = st.gauge = st.ecu = null; pills(); renderEcu(); log('info', 'ตัดการเชื่อมต่อ');
  }
  async function connect(kind) {
    try {
      if (kind === 'gauge-only' || kind === 'gauge-only-usb') {
        const via = kind === 'gauge-only-usb' ? 'usb' : 'ble';
        if (via === 'usb' && window.JetApp && st.t && st.t.kind === 'usb') throw new Error('มือถือมีพอร์ต USB เดียว (ใช้กับสาย K-line อยู่) — ต่อเกจด้วย Bluetooth แทน');
        if (st.gauge && st.gauge !== st.t) { try { await st.gauge.close(); } catch (e) {} }
        const g = new GaugeLink(via); await g.open(); st.gauge = g; g.onLost = () => { if (st.gauge === g) st.gauge = null; pills(); toast('เกจหลุดการเชื่อมต่อ'); };
        log('info', 'เชื่อมเกจแล้ว ' + (g.fw || '')); toast('เชื่อมเกจแล้ว'); pills(); return;
      }
      await disconnect();
      let t;
      if (kind === 'demo') t = new SimTransport({ latency: 2 });
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
  const ARC_LEN = 2 * Math.PI * 118 * 0.75;
  // centre of the round gauge: tap to switch km/h ⇄ AFR
  function showCenter(d) {
    d = d || st.last || {};
    const afr = S.center === 'afr', v = afr ? d.AFR : d.SPD, el = $('#vSPD');
    if (v != null) el.textContent = afr ? (+v).toFixed(1) : Math.round(v);
    else if (afr) el.textContent = '--';
    el.style.color = !afr || v == null ? '' : v < 11.5 ? '#ff6b7a' : v > 15.5 ? '#ffb020' : '#7dffb8';
    $('#vUnit').textContent = afr ? 'AFR ⇄' : 'km/h ⇄';
  }
  $('.gauge').addEventListener('click', () => {
    S.center = S.center === 'afr' ? 'spd' : 'afr'; saveS(); showCenter();
    if (S.center === 'afr' && (!st.last || st.last.AFR == null)) toast('ยังไม่มีค่า AFR — ต้องต่อ Smart Gauge ที่มีไวด์แบนด์ (หรือเปิด DEMO)', 3500);
  });
  function showLive(d) {
    const f = (k, n) => { const el = $('#v' + k); if (el && d[k] != null) el.textContent = n == null ? d[k] : (+d[k]).toFixed(n); };
    f('ECT', 0); f('IAT', 0); f('MAP', 0); f('BATT', 1); f('INJ', 2); f('IGN', 1); f('TPS', 1);
    showCenter(d);
    if (d.RPM != null) {
      $('#vRPM').textContent = Math.round(d.RPM).toLocaleString('en-US');
      const p = Math.max(0, Math.min(1, d.RPM / (S.rpmMax || 12000)));
      $('#arc').setAttribute('stroke-dasharray', (p * ARC_LEN).toFixed(1) + ' 999');
    }
    if (d.TPS != null) $('#tpsBar').style.width = Math.max(0, Math.min(100, d.TPS)) + '%';
  }
  // merge gauge sensors (AFR wideband / GPS / EOT / O2) and phone GPS into a live sample
  async function mergeSensors(d) {
    if (st.gauge && st.gauge.sensors) {
      const s = await st.gauge.sensors();
      if (s) { st.sens = s; if (s.afrOk) d.AFR = s.afr; if (s.eotOk) d.EOT = s.eot; if (s.o2Ok) d.O2 = s.o2; }
    }
    const g = window.JetGps && JetGps.current();
    if (g) { d.GPS = g.spd; d.gpsSrc = g.src; }
    d.t = Date.now();
    return d;
  }
  function emitLive(d) { (window.JetHooks || []).forEach((f) => { try { f(d); } catch (e) { console.error(e); } }); }
  async function liveLoop() {
    st.liveRunning = true;
    let fails = 0;
    while (st.live && st.ecu && !st.busy) {
      try {
        const d = await st.ecu.readLive();
        if (d) { fails = 0; await mergeSensors(d); showLive(d); emitLive(d); } else if (++fails > 5) { log('err', 'LIVE: กล่องไม่ตอบ'); stopLive(); }
      } catch (e) { stopLive(); }
      await P.sleep(40);
    }
    st.liveRunning = false;
  }
  function startLive() { if (!st.ecu || st.live) return; st.live = true; $('#bLive').textContent = '■ STOP'; $('#bLive').classList.add('on'); liveLoop(); }
  function stopLive() { st.live = false; $('#bLive').textContent = '▶ LIVE'; $('#bLive').classList.remove('on'); }
  $('#bLive').onclick = () => { if (!st.ecu) return toast('ยังไม่ได้เชื่อมต่อ'); st.live ? stopLive() : startLive(); };
  /* ---------------- DTC ---------------- */
  const dtcHtml = (l) => l.length ? l.map((k) => `<div class="dtc"><b>${k}</b><span>${esc(P.dtcText(k))}</span></div>`).join('') : '<div class="okc">ไม่มีโค้ด ✔</div>';
  $('#bDtc').onclick = () => op('อ่านโค้ด DTC', async () => { const r = await st.ecu.readDTC(); $('#dtcCur').innerHTML = dtcHtml(r.current); $('#dtcPast').innerHTML = dtcHtml(r.past); });
  $('#bDtcClr').onclick = async () => { if (await ask('ลบโค้ดทั้งหมดในกล่อง?', true)) op('ลบโค้ด', async () => { toast((await st.ecu.clearDTC()) ? 'ลบโค้ดแล้ว' : 'ลบไม่สำเร็จ'); const r = await st.ecu.readDTC(); $('#dtcCur').innerHTML = dtcHtml(r.current); $('#dtcPast').innerHTML = dtcHtml(r.past); }); };

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
  window.JetCore = { st, S, saveS, $, $$, P, toast, ask, askText, dlg, op, go, pageOf, fbytes, addFile, refreshFiles, log, esc, kb, download, modal,
    startLive, stopLive, renderHex, mergeSensors, emitLive, models, parseHex };

  /* ---------------- boot ---------------- */
  (async () => {
    const t0 = Date.now();
    const sp = (pct, msg) => { $('#spBar').style.width = pct + '%'; if (msg) $('#spMsg').textContent = msg; };
    const hideSplash = () => { const el = $('#splash'); if (!el || el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), 600); };
    setTimeout(hideSplash, 6000); // fail-safe
    sp(15, 'โหลดธีมและหน้าจอ…');
    applyTheme(); applyLogo(); go(0); pills(); renderEcu(); showCenter();
    sp(45, 'เปิดคลังไฟล์ ECU…');
    try { await DB.open(); await refreshFiles(); } catch (e) { toast('เปิดคลังไฟล์ไม่ได้: ' + e.message); }
    sp(75, 'เตรียมโปรโตคอล K-LINE…');
    await P.sleep(250);
    sp(100, window.JetApp ? 'พร้อม · USB OTG + Bluetooth' : 'พร้อมใช้งาน');
    await P.sleep(Math.max(300, 1900 - (Date.now() - t0)));
    hideSplash();
    log('info', window.JetApp ? 'Jet_HONDA Tune (Android APP) พร้อมใช้งาน · USB OTG + Bluetooth' : 'Jet_HONDA Tune พร้อมใช้งาน · Web Serial: ' + ('serial' in navigator ? 'มี' : 'ไม่มี') + ' · Bluetooth: ' + ('bluetooth' in navigator ? 'มี' : 'ไม่มี'));
  })();
})();
