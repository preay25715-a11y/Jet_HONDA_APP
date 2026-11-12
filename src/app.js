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
  $$('[data-close]').forEach((b) => b.onclick = () => b.closest('.modal').classList.remove('show'));

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
  const THEMES = [['#2a7bff', 'น้ำเงิน'], ['#00c8ff', 'ฟ้า'], ['#7a5cff', 'ม่วง'], ['#3dff2a', 'เขียวนีออน'], ['#ff2a3a', 'แดง']];
  function applyTheme() { document.documentElement.style.setProperty('--ac', S.theme); }
  $('#themes').innerHTML = THEMES.map(([c, n]) => `<div style="text-align:center"><button data-c="${c}" style="background:${c};color:${c}"></button><div class="mut" style="font-size:12px;margin-top:5px">${n}</div></div>`).join('');
  $$('#themes button').forEach((b) => b.onclick = () => { S.theme = b.dataset.c; applyTheme(); saveS(); markTheme(); });
  const markTheme = () => $$('#themes button').forEach((b) => b.classList.toggle('on', b.dataset.c === S.theme));

  /* ---------------- logo ---------------- */
  function applyLogo() {   // custom-logo option removed: always show the built-in logo
    try { localStorage.removeItem('jht.logo'); } catch (e) {}
    $('#brandCustom').innerHTML = ''; $('#brandDefault').style.display = 'flex';
  }
  $('#brand').onclick = () => go(0);

  /* ---------------- pages ---------------- */
  const pages = $$('.page');
  $('#nav').innerHTML = pages.map((p, i) => `<button data-p="${i}">${p.dataset.tab || p.dataset.name}</button>`).join('') + '<button id="bSet">Setup</button>';
  $('#seg').innerHTML = pages.map(() => '<i></i>').join('');
  let curPage = 0;
  function go(i) {
    curPage = i;
    pages.forEach((p, k) => p.classList.toggle('show', k === i));
    $$('#nav button[data-p]').forEach((b, k) => b.classList.toggle('on', k === i));
    $$('#seg i').forEach((b, k) => b.classList.toggle('on', k === i));
    if (pages[i].dataset.tab === 'Hex') renderHex();
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
  $('#pGauge').onclick = () => { if (!st.gauge) connect('gauge-only'); else toast('เชื่อมเกจอยู่แล้ว'); };
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
      if (kind === 'gauge-only') {
        const g = new GaugeLink('ble'); await g.open(); st.gauge = g; g.onLost = () => { st.gauge = null; pills(); };
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
      if (kind === 'demo') startLive();
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
    finally { st.busy = false; pills(); renderStats(); if (wasLive && name !== 'อัดไฟล์') startLive(); }
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
  $('#bDetect').onclick = detect;
  function renderEcu() {
    const e = st.ecu, s = e ? e.state : null;
    $('#ecuState').textContent = s || '—';
    $('#ecuState').className = s === 'OK' || s === 'SECURE' ? 'okc' : s ? 'warn' : 'mut';
    $('#ecuInfo').innerHTML = !e ? '<span>สถานะ</span><span>ยังไม่เชื่อมต่อ</span>' : [
      ['สถานะ', P.STATE_TH[s] || s], ['ECU ID', e.ecuId ? P.hex(e.ecuId) : '—'],
      ['ECU ID (ascii)', e.ecuId ? esc(String.fromCharCode(...e.ecuId.map((b) => (b > 31 && b < 127 ? b : 46)))) : '—'],
      ['Flash count', st.fcount ? P.hex(st.fcount) : '—'], ['ช่องทาง', st.t ? st.t.name : '—'],
    ].map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  }
  const ARC_LEN = 2 * Math.PI * 118 * 0.75;
  function showLive(d) {
    const f = (k, n) => { const el = $('#v' + k); if (el && d[k] != null) el.textContent = n == null ? d[k] : (+d[k]).toFixed(n); };
    f('ECT', 0); f('IAT', 0); f('MAP', 0); f('BATT', 1); f('INJ', 2); f('IGN', 1); f('TPS', 1); f('SPD', 0);
    if (d.RPM != null) {
      $('#vRPM').textContent = Math.round(d.RPM).toLocaleString('en-US');
      const p = Math.max(0, Math.min(1, d.RPM / (S.rpmMax || 12000)));
      $('#arc').setAttribute('stroke-dasharray', (p * ARC_LEN).toFixed(1) + ' 999');
    }
    if (d.TPS != null) $('#tpsBar').style.width = Math.max(0, Math.min(100, d.TPS)) + '%';
  }
  async function liveLoop() {
    st.liveRunning = true;
    let fails = 0;
    while (st.live && st.ecu && !st.busy) {
      try {
        const d = await st.ecu.readLive();
        if (d) { fails = 0; showLive(d); } else if (++fails > 5) { log('err', 'LIVE: กล่องไม่ตอบ'); stopLive(); }
      } catch (e) { stopLive(); }
      await P.sleep(40);
    }
    st.liveRunning = false;
  }
  function startLive() { if (!st.ecu || st.live) return; st.live = true; $('#bLive').textContent = '■ STOP'; $('#bLive').classList.add('on'); liveLoop(); }
  function stopLive() { st.live = false; $('#bLive').textContent = '▶ LIVE'; $('#bLive').classList.remove('on'); }
  $('#bLive').onclick = () => { if (!st.ecu) return toast('ยังไม่ได้เชื่อมต่อ'); st.live ? stopLive() : startLive(); };
  $('#bTables').onclick = () => op('อ่านตารางทั้งหมด', async () => {
    const t = await st.ecu.probeTables();
    const el = $('#tables'); el.style.display = 'block';
    el.textContent = Object.keys(t).length ? Object.entries(t).map(([k, v]) => 'T' + (+k).toString(16).toUpperCase().padStart(2, '0') + ': ' + P.hex(v)).join('\n') : 'ไม่มีตารางตอบกลับ';
  });

  /* ---------------- DTC ---------------- */
  const dtcHtml = (l) => l.length ? l.map((k) => `<div class="dtc"><b>${k}</b><span>${esc(P.dtcText(k))}</span></div>`).join('') : '<div class="okc">ไม่มีโค้ด ✔</div>';
  $('#bDtc').onclick = () => op('อ่านโค้ด DTC', async () => { const r = await st.ecu.readDTC(); $('#dtcCur').innerHTML = dtcHtml(r.current); $('#dtcPast').innerHTML = dtcHtml(r.past); });
  $('#bDtcClr').onclick = () => { if (confirm('ลบโค้ดทั้งหมดในกล่อง?')) op('ลบโค้ด', async () => { toast((await st.ecu.clearDTC()) ? 'ลบโค้ดแล้ว' : 'ลบไม่สำเร็จ'); $('#bDtc').click(); }); };

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
    $('#flist').innerHTML = st.files.length ? st.files.map((f) => {
      const u = fbytes(f), ok = P.binChecksumOK(u);
      return `<div class="fi${st.sel && st.sel.id === f.id ? ' sel' : ''}" data-id="${f.id}"><span class="chip">▣</span><div style="flex:1;min-width:0"><b>${esc(f.name)}<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? 'CKS OK' : 'CKS ✗'}</span></b><small>${kb(u.length)} · ${fmtDate(f.date)} · ผลรวม ${P.h8(P.binSum8(u))}${f.origin === 'read' ? ' · ดูดจากกล่อง' : ''}</small></div></div>`;
    }).join('') : '<div class="mut">ยังไม่มีไฟล์ — ดูดจากกล่อง หรือเลือกไฟล์ .bin จากเครื่อง</div>';
    $$('#flist .fi').forEach((el) => el.onclick = () => selectFile(el.dataset.id));
    const opts = '<option value="">—</option>' + st.files.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
    const a = $('#hxA').value, b = $('#hxB').value; $('#hxA').innerHTML = opts; $('#hxB').innerHTML = opts; $('#hxA').value = a; $('#hxB').value = b;
  }
  const layout = (f) => P.detectLayout(fbytes(f), f);
  function curLayout() {
    if (!st.sel) return null;
    if (st.manual) return { start: parseHex($('#mStart').value), cks: parseHex($('#mCks').value), why: 'กำลังแก้เอง' };
    return layout(st.sel);
  }
  function setManual(on) {
    st.manual = on;
    ['#mStart', '#mCks'].forEach((s) => ($(s).readOnly = !on));
    $('#bManual').textContent = on ? '✔ บันทึกค่า' : '✏ แก้เอง';
  }
  function selectFile(id) {
    st.sel = st.files.find((f) => f.id === id) || null;
    $$('#flist .fi').forEach((el) => el.classList.toggle('sel', st.sel && el.dataset.id === st.sel.id));
    if (st.sel && !$('#hxA').value) $('#hxA').value = id;
    setManual(false); renderSel();
  }
  $('#bManual').onclick = async () => {
    if (!st.sel) return toast('เลือกไฟล์ก่อน');
    if (!st.manual) { setManual(true); $('#mStart').focus(); return; }
    st.sel.startManual = parseHex($('#mStart').value); st.sel.cksManual = parseHex($('#mCks').value);
    await DB.put(st.sel); setManual(false); renderSel(); toast('บันทึกค่าให้ไฟล์นี้แล้ว');
  };
  function renderSel() {
    const f = st.sel;
    $('#selName').textContent = f ? f.name : 'ยังไม่ได้เลือกไฟล์ — เลือกจากคลังด้านซ้าย';
    if (!f) { $('#fileInfo').innerHTML = ''; $('#mStart').value = $('#mCks').value = ''; $('#autoWhy').textContent = ''; return; }
    const u = fbytes(f), ok = P.binChecksumOK(u), L = curLayout();
    if (!st.manual) { $('#mStart').value = P.hx(L.start, 5); $('#mCks').value = P.hx(L.cks, 5); }
    const ms = f.startManual != null, mc = f.cksManual != null;
    $('#aStart').textContent = ms ? 'ตั้งเอง' : 'AUTO'; $('#aStart').className = 'badge ' + (ms ? 'w' : 'ok');
    $('#aCks').textContent = mc ? 'ตั้งเอง' : 'AUTO'; $('#aCks').className = 'badge ' + (mc ? 'w' : 'ok');
    $('#autoWhy').innerHTML = esc(L.why || '') + (ms || mc ? ' · <a href="#" id="bAuto">คืนค่า AUTO</a>' : '');
    if (ms || mc) $('#bAuto').onclick = async (e) => { e.preventDefault(); delete f.startManual; delete f.cksManual; await DB.put(f); renderSel(); };
    const warn = [];
    if (u.length % 64) warn.push('ขนาดไม่หารด้วย 64 — อัดไม่ได้');
    if (!L.known && !ms && f.readStart == null) warn.push('ขนาดไฟล์ไม่อยู่ในตาราง — ตรวจ Start/Checksum ก่อนอัด');
    if (L.cks >= u.length) warn.push('ตำแหน่ง checksum อยู่นอกไฟล์');
    $('#fileInfo').innerHTML = [
      ['ขนาด', kb(u.length) + ' (' + u.length + ' byte)'],
      ['Checksum', ok ? '<span class="okc">ผ่าน ✔ (ผลรวม 0x00)</span>' : `<span class="badc">ไม่ผ่าน (ผลรวม ${P.h8(P.binSum8(u))})</span> — กด "แก้ Checksum" หรือให้แก้อัตโนมัติตอนอัด`],
      ['ที่มา', f.origin === 'read' ? 'ดูดจากกล่อง' : f.origin === 'fix' ? 'แก้ checksum' : 'นำเข้าจากเครื่อง'],
      ['CRC32', P.hx(P.crc32(u), 8)],
      ['หมายเหตุ', warn.length ? `<span class="warn">${warn.join(' · ')}</span>` : '<span class="mut">—</span>'],
    ].map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  }
  $('#bImport').onclick = () => $('#fImport').click();
  $('#fImport').onchange = async (e) => {
    for (const file of e.target.files) {
      const u = new Uint8Array(await file.arrayBuffer());
      if (u.length > 4 * 1024 * 1024) { toast('ไฟล์ใหญ่เกิน'); continue; }
      await addFile(file.name.replace(/\.bin$/i, ''), u, { origin: 'import' });
    }
    e.target.value = '';
  };
  $('#bDown').onclick = () => { if (!st.sel) return toast('เลือกไฟล์ก่อน'); download(st.sel.name + '.bin', fbytes(st.sel)); };
  $('#bRen').onclick = async () => { if (!st.sel) return; const n = prompt('ชื่อไฟล์ใหม่', st.sel.name); if (n) { st.sel.name = n.trim(); await DB.put(st.sel); await refreshFiles(); renderSel(); } };
  $('#bDel').onclick = async () => { if (!st.sel || !confirm('ลบไฟล์ "' + st.sel.name + '" ออกจากคลัง?')) return; await DB.del(st.sel.id); st.sel = null; await refreshFiles(); renderSel(); };
  $('#bFix').onclick = async () => {
    if (!st.sel) return toast('เลือกไฟล์ก่อน');
    const u = fbytes(st.sel), L = curLayout(), idx = L.cks;
    if (P.binChecksumOK(u)) return toast('checksum ผ่านอยู่แล้ว');
    try {
      const o = P.binFixChecksum(u, idx), s = st.sel;
      await addFile(s.name.replace(/_FIX$/, '') + '_FIX', o, { origin: 'fix', readStart: s.readStart, startManual: s.startManual, cksManual: s.cksManual });
      toast('สร้างไฟล์ _FIX แล้ว (byte ' + P.hx(idx, 5) + ' = ' + P.h8(o[idx]) + ')');
    } catch (e) { toast(e.message); }
  };

  /* ---------------- model select (READ page) ---------------- */
  function fillModels() {
    $('#model').innerHTML = models().map((m) => `<option value="${m.id}">${esc(m.name)}${m.src === 'family' ? ' ⚠' : ''}</option>`).join('');
    $('#model').value = S.modelId; applyModel(false);
  }
  function applyModel(save) {
    const m = models().find((x) => x.id === $('#model').value) || models()[0];
    $('#modelNote').innerHTML = {
      family: '⚠ ค่าตั้งต้นตระกูลกล่อง Keihin เล็ก — ระบบจะยืนยันขนาด/ตำแหน่งจริงจากกล่องให้เอง',
      HondaECU: '✔ ค่าจากตาราง checksum ของโปรเจกต์ HondaECU', auto: 'ระบบหา Start Offset และขนาดไฟล์จากกล่องให้อัตโนมัติ', custom: 'ค้นหาอัตโนมัติจากกล่อง',
    }[m.src] || '';
    $('#rAuto').innerHTML = [['Start Offset', '<span class="okc">AUTO</span> (ลองที่ ' + P.hx(m.start || 0, 5) + ' ก่อน)'], ['ขนาดไฟล์', m.size ? m.size + ' KB' : '<span class="okc">AUTO</span> (ดูดจนกล่องหยุดตอบ)'], ['Checksum', '<span class="okc">AUTO</span> (หาจากไฟล์ที่ได้)']]
      .map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    if (save) { S.modelId = m.id; saveS(); }
  }
  $('#model').onchange = () => applyModel(true);
  ['#mStart', '#mCks'].forEach((s) => $(s).oninput = renderSel);

  /* ---------------- progress (r = READ page, w = WRITE page) ---------------- */
  function progShow(x, on, cancellable) { st.pg = x; $('#' + x + 'prog').style.display = on ? 'block' : 'none'; $('#' + x + 'bCancel').style.display = cancellable ? '' : 'none'; if (on) progSet(x, 0, 1, 0, ''); }
  function progSet(x, n, total, ms, stage) {
    const p = total ? n / total : 0;
    $('#' + x + 'pPct').textContent = Math.floor(p * 100) + '%'; $('#' + x + 'pBar').style.width = (p * 100).toFixed(1) + '%';
    if (stage != null) $('#' + x + 'pStage').textContent = stage;
    if (ms) { const bps = n / (ms / 1000); $('#' + x + 'pSub').textContent = `${kb(n)} / ${kb(total)} · ${(bps / 1024).toFixed(2)} KB/s · เหลือ ~${Math.max(0, Math.round((total - n) / Math.max(bps, 1)))} วิ`; }
  }
  const stage = (x, s) => { $('#' + x + 'pStage').textContent = s; };
  $('#rbCancel').onclick = $('#wbCancel').onclick = () => st.ecu && st.ecu.cancel();

  /* ---------------- READ (ดูดไฟล์) ---------------- */
  $('#bRead').onclick = () => op('ดูดไฟล์', async () => {
    const m = models().find((x) => x.id === $('#model').value) || models()[0];
    const max = m.size ? m.size * 1024 : 0x100000;
    $('#rIdle').style.display = 'none'; $('#rDone').style.display = 'none';
    progShow('r', true, true); progSet('r', 0, max, 0, 'ตรวจสถานะกล่อง…');
    const s = await st.ecu.detect();
    if (s === 'OFF' || s === 'UNKNOWN') throw new Error('ติดต่อกล่องไม่ได้ (' + s + ') — เช็คปลั๊ก/กุญแจ ON');
    if (s === 'FLASH' || s.startsWith('RECOVER')) throw new Error('กล่องอยู่โหมดแฟลช/กู้ — ต้องอัดไฟล์ให้สำเร็จก่อนจึงดูดได้');
    if (S.pw) { stage('r', 'ส่งรหัส Security Access…'); const ok = await st.ecu.unlock(P.parseHexBytes(S.pw)); log('info', 'Security: ' + (ok ? 'ผ่าน' : 'ไม่ตอบ')); }
    stage('r', 'ค้นหา Start Offset อัตโนมัติ…');
    const start = await st.ecu.probeStart([...new Set([m.start || 0, 0x0, 0x4000, 0x8000, 0x10000])]);
    if (start == null) throw new Error('กล่องไม่ยอมให้อ่าน — ลองใส่รหัส Security ในตั้งค่า');
    log('info', 'Start Offset = ' + P.hx(start, 5));
    stage('r', 'กำลังดูดไฟล์… (เริ่มที่ ' + P.hx(start, 5) + ')');
    const u = await st.ecu.readFlash({ start, maxBytes: max, onProgress: (n, t, ms) => progSet('r', n, m.size ? t : Math.max(n, 65536 * Math.ceil(n / 65536)), ms) });
    if (!u.length) throw new Error('กล่องไม่ยอมให้อ่าน — ลองใส่รหัส Security ในตั้งค่า');
    const ok = P.binChecksumOK(u), L = P.detectLayout(u, { readStart: start });
    const name = (m.id !== 'auto' && m.id !== 'custom' ? m.name.split(' (')[0].replace(/\s+/g, '') : 'ECU') + '_' + new Date().toISOString().slice(2, 16).replace(/[-:T]/g, '');
    const f = await addFile(name, u, { origin: 'read', readStart: start, ecuId: Array.from(st.ecu.ecuId || []) });
    st.lastRead = f;
    progSet('r', u.length, u.length, 0, `ดูดเสร็จ ${kb(u.length)} · checksum ${ok ? 'ผ่าน ✔' : 'ไม่ผ่าน ✗ (อาจอ่านไม่ครบ)'}`);
    $('#rInfo').innerHTML = [['ไฟล์', esc(name)], ['ขนาด', kb(u.length)], ['Start Offset', P.hx(start, 5) + ' <span class="badge ok">AUTO</span>'],
      ['Checksum', (ok ? '<span class="okc">ผ่าน</span>' : '<span class="badc">ไม่ผ่าน</span>') + ' · ตำแหน่ง ' + P.hx(L.cks, 5) + ' <span class="badge ok">AUTO</span>'],
      ['ECU ID', st.ecu.ecuId ? P.hex(st.ecu.ecuId) : '—']].map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    $('#rDone').style.display = 'block'; $('#rbCancel').style.display = 'none';
    toast('ดูดไฟล์สำเร็จ บันทึกเข้าคลังแล้ว');
  });
  $('#rDown').onclick = () => st.lastRead && download(st.lastRead.name + '.bin', fbytes(st.lastRead));
  $('#rToW').onclick = () => { if (st.lastRead) selectFile(st.lastRead.id); go(pageOf('อัดไฟล์')); };

  /* ---------------- WRITE (อัดไฟล์) ---------------- */
  $('#bWrite').onclick = () => {
    if (!st.sel) return toast('เลือกไฟล์ในคลังก่อน');
    if (st.manual) return toast('กด "บันทึกค่า" ก่อน');
    if (!st.ecu) { toast('ยังไม่ได้เชื่อมต่อ'); return modal('#mConnect', true); }
    const u = fbytes(st.sel), ok = P.binChecksumOK(u), L = curLayout();
    $('#wInfo').innerHTML = [['ไฟล์', esc(st.sel.name)], ['ขนาด', kb(u.length)], ['Start Offset', P.hx(L.start, 5)], ['ตำแหน่ง Checksum', P.hx(L.cks, 5)],
      ['Checksum', ok ? '<span class="okc">ผ่าน</span>' : '<span class="badc">ไม่ผ่าน — ต้องติ๊กแก้อัตโนมัติ</span>'], ['ช่องทาง', st.t.name]]
      .map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    $$('.wc').forEach((c) => (c.checked = false)); $('#wFix').checked = !ok; upd();
    modal('#mWrite', true);
  };
  const upd = () => { $('#wGo').disabled = !$$('.wc').every((c) => c.checked); };
  $$('.wc').forEach((c) => c.onchange = upd);
  $('#wGo').onclick = () => {
    modal('#mWrite', false);
    op('อัดไฟล์', async () => {
      const L = curLayout();
      let u = fbytes(st.sel);
      if (!P.binChecksumOK(u)) { if (!$('#wFix').checked) throw new Error('checksum ไม่ผ่าน'); u = P.binFixChecksum(u, L.cks); log('info', 'แก้ checksum ที่ ' + P.hx(L.cks, 5) + ' ก่อนส่ง'); }
      progShow('w', true, true); window.onbeforeunload = () => 'กำลังอัดไฟล์!';
      let wl = null; try { wl = navigator.wakeLock && await navigator.wakeLock.request('screen'); } catch (e) {} if (window.JetApp) JetApp.keepScreen(true);
      try {
        const ok = await st.ecu.writeFlash(u, {
          start: L.start, block: +S.block, eraseWait: +S.eraseWait, fast: st.t.kind === 'demo',
          onStage: (s) => { stage('w', s); log('info', s); if (/ลบ|erase/.test(s)) $('#wbCancel').style.display = 'none'; },
          onProgress: (n, t, ms) => progSet('w', n, t, ms),
        });
        $('#wbCancel').style.display = 'none';
        if (ok) { progSet('w', 1, 1, 0); toast('อัดไฟล์สำเร็จ ✔', 6000); } else toast('อัดเสร็จแต่การตรวจท้ายไม่ผ่าน — ลองอัดซ้ำ', 6000);
        await P.sleep(300); await st.ecu.detect(); renderEcu();
      } finally { window.onbeforeunload = null; try { wl && wl.release(); } catch (e) {} if (window.JetApp) JetApp.keepScreen(false); }
    });
  };

  /* ---------------- send to Smart Gauge ---------------- */
  $('#bGauge').onclick = async () => {
    if (!st.sel) return toast('เลือกไฟล์ก่อน');
    if (!st.gauge) { toast('ยังไม่ได้เชื่อมเกจ — แตะ GAUGE ด้านบน'); return; }
    if (st.busy) return toast('กำลังทำงานอื่นอยู่');
    let u = fbytes(st.sel);
    if (!P.binChecksumOK(u) && confirm('checksum ไม่ผ่าน — แก้ checksum ก่อนส่งไปเกจ?')) u = P.binFixChecksum(u, curLayout().cks);
    const wasLive = st.live; stopLive(); st.busy = true; while (st.liveRunning) await P.sleep(10);
    progShow('w', true, false); stage('w', 'ส่งไฟล์ไปเกจ…'); const t0 = Date.now();
    try {
      await st.gauge.sendFile(st.sel.name, u, (n, t) => progSet('w', n, t, Date.now() - t0));
      stage('w', 'ส่งไฟล์ถึงเกจแล้ว ✔ กดปุ่ม FLASH ที่หน้าเกจเพื่อเริ่มแฟลช'); toast('ส่งไฟล์ไปเกจแล้ว'); log('info', 'ส่ง ' + st.sel.name + ' → เกจ CRC ' + P.hx(P.crc32(u), 8));
    } catch (e) { toast(e.message, 5000); log('err', e.message); }
    finally { st.busy = false; if (wasLive) startLive(); }
  };

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
    if (!confirm('เขียน EEPROM จากไฟล์ ' + f.name + ' ?')) return;
    op('เขียน EEPROM', async () => { await st.ecu.eepromWrite(u); toast('เขียน EEPROM สำเร็จ'); st.ee = u; showEe(); });
  };
  const fmt = (ff) => { if (confirm('ฟอร์แมต EEPROM เป็น ' + (ff ? 'FF' : '00') + ' ? ข้อมูลเดิมจะหายทั้งหมด')) op('ฟอร์แมต EEPROM', async () => toast((await st.ecu.eepromFormat(ff)) ? 'ฟอร์แมตแล้ว' : 'ไม่สำเร็จ')); };
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
    markTheme(); $('#sWake').value = S.wake; $('#sTo').value = S.timeout; $('#sErase').value = S.eraseWait; $('#sBlock').value = S.block; $('#sPw').value = S.pw;
    $('#sModels').value = JSON.stringify(models().map((m) => Object.assign({}, m, { start: P.hx(m.start), cks: P.hx(m.cks) })), null, 1);
    modal('#mSet', true);
  };
  $('#sSave').onclick = () => {
    try {
      if (S.pw !== $('#sPw').value) P.parseHexBytes($('#sPw').value);
      const ms = JSON.parse($('#sModels').value).map((m) => Object.assign(m, { start: parseHex(m.start), cks: parseHex(m.cks), size: +m.size || 0 }));
      Object.assign(S, { wake: $('#sWake').value, timeout: +$('#sTo').value || 350, eraseWait: +$('#sErase').value || 0, block: +$('#sBlock').value, pw: $('#sPw').value.trim(), models: ms });
      saveS(); if (st.ecu) st.ecu.timeout = S.timeout; if (st.t && st.t.wakeMode) st.t.wakeMode = S.wake;
      fillModels(); modal('#mSet', false); toast('บันทึกแล้ว');
    } catch (e) { toast('ผิดพลาด: ' + e.message, 4000); }
  };
  $('#sReset').onclick = () => { if (confirm('คืนค่าตั้งค่าทั้งหมด?')) { localStorage.removeItem(LS); location.reload(); } };

  function renderStats() { if (st.ecu) $('#stats').textContent = `TX ${st.ecu.stats.tx} · RX ${st.ecu.stats.rx} · retry ${st.ecu.stats.retry} · bad ${st.ecu.stats.bad}`; }
  setInterval(renderStats, 1500);

  window.JetBack = () => {
    const m = document.querySelector('.modal.show'); if (m) { m.classList.remove('show'); return true; }
    if (!pages[0].classList.contains('show')) { go(0); return true; }
    return false;
  };

  /* ---------------- boot ---------------- */
  (async () => {
    applyTheme(); applyLogo(); go(0); fillModels(); pills(); renderEcu();
    try { await DB.open(); await refreshFiles(); } catch (e) { toast('เปิดคลังไฟล์ไม่ได้: ' + e.message); }
    log('info', window.JetApp ? 'Jet_HONDA Tune (Android APP) พร้อมใช้งาน · USB OTG + Bluetooth' : 'Jet_HONDA Tune พร้อมใช้งาน · Web Serial: ' + ('serial' in navigator ? 'มี' : 'ไม่มี') + ' · Bluetooth: ' + ('bluetooth' in navigator ? 'มี' : 'ไม่มี'));
  })();
})();
