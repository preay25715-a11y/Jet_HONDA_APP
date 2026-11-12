/* =====================================================================
 * Jet_HONDA Tune — ui-extra.js
 * GRID · GRAPH · TUNE (map editor 2D/3D) · AFR LOG · DRAG LOG · GPS · TOOLS
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.JetCore, T = window.HT, P = window.HP;
  const { st, S, $, $$, toast, esc } = C;
  const H = (window.JetHooks = window.JetHooks || []);
  const PH = (window.JetPageHooks = window.JetPageHooks || []);
  const FH = (window.JetFileHooks = window.JetFileHooks || []);
  const LSget = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  let curTab = 'Dash';
  const last = (st.last = {});

  /* ================= GPS (gauge first, phone as fallback) ================= */
  const hav = (a, b, c, d) => { const R = 6371000, r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2); return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y)); };
  const gps = {
    src: S.gpsSrc || 'auto', phone: null, watch: null, err: null,
    ensurePhone() {
      if (this.src === 'gauge' || this.watch != null || !navigator.geolocation) return;
      this.watch = navigator.geolocation.watchPosition((p) => {
        const c = p.coords, t = p.timestamp || Date.now();
        let spd = c.speed != null && !isNaN(c.speed) ? c.speed * 3.6 : null;
        if (spd == null && this.phone) { const dt = (t - this.phone.t) / 1000; if (dt > 0) spd = hav(this.phone.lat, this.phone.lon, c.latitude, c.longitude) / dt * 3.6; }
        this.phone = { t, lat: c.latitude, lon: c.longitude, spd: Math.max(0, spd || 0), acc: c.accuracy, src: 'PHONE' };
        this.err = null;
        const cur = this.current();
        if (cur && cur.src === 'PHONE') { dragFeed(t, cur.spd); if (!st.live) C.emitLive({ GPS: cur.spd, gpsSrc: 'PHONE', t: Date.now() }); }
      }, (e) => { this.err = e.message || 'GPS ไม่พร้อม'; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    },
    stopPhone() { if (this.watch != null) navigator.geolocation.clearWatch(this.watch); this.watch = null; this.phone = null; },
    current() {
      const g = st.sens, now = Date.now();
      if (this.src !== 'phone' && g && g.gpsOk && now - g.t < 2000) return { spd: g.spd, sats: g.sats, satsView: g.satsView, src: 'GAUGE', t: g.t };
      if (this.src !== 'gauge' && this.phone && now - this.phone.t < 3500) return this.phone;
      return null;
    },
  };
  window.JetGps = gps;
  setInterval(() => {
    const g = gps.current(), el = $('#tGps');
    el.className = 'chipst' + (g ? ' on' : gps.watch != null ? ' mid' : '');
    el.textContent = g ? 'GPS ' + (g.src === 'GAUGE' ? 'เกจ' : 'มือถือ') : 'GPS';
  }, 1000);
  $('#tGps').style.cursor = 'pointer';
  $('#tGps').onclick = () => { gps.ensurePhone(); C.go(C.pageOf('Drag')); };

  // keep reading gauge sensors (AFR / GPS) when the ECU live loop is not running
  (async function sensorLoop() {
    for (;;) {
      await P.sleep(150);
      if (st.live || st.busy || !st.gauge || !st.gauge.sensors || st.liveRunning) continue;
      try { const d = {}; await C.mergeSensors(d); if (d.AFR != null || d.GPS != null) C.emitLive(d); } catch (e) { /* ignore */ }
    }
  })();

  /* ================= GRID ================= */
  const GRID = [
    { k: 'TPS', u: '%', d: 1, col: '#4d8dff', bar: [0, 100] }, { k: 'ECT', l: 'W.TEMP', u: '°C', d: 0 }, { k: 'BATT', u: 'V', d: 1, col: '#ff5a6a' },
    { k: 'AFR', u: '', d: 1, col: '#2fd18b', bar: [10, 18] }, { k: 'INJ', u: 'ms', d: 2 }, { k: 'IGN', u: '°BTDC', d: 1 },
    { k: 'RPM', u: 'rpm', d: 0, bar: [0, 12000], grad: 1 }, { k: 'MAP', u: 'kPa', d: 0 }, { k: 'SPD', u: 'km/h', d: 0 },
    { k: 'EOT', u: '°C', d: 0 }, { k: 'IAT', u: '°C', d: 0 }, { k: 'O2', u: 'V', d: 2 },
  ];
  $('#ggrid').innerHTML = GRID.map((g) => `<div class="card gt"><div class="gh"><span>${g.l || g.k}</span><span>${g.u}</span></div><div class="gv" id="gv${g.k}" style="${g.col ? 'color:' + g.col : ''}">--</div>${g.bar ? `<div class="gbar" id="gb${g.k}">${'<i></i>'.repeat(18)}</div>` : ''}</div>`).join('');
  function renderGrid() {
    for (const g of GRID) {
      const v = last[g.k]; const el = $('#gv' + g.k);
      el.textContent = v == null ? '--' : (+v).toFixed(g.d);
      if (g.bar) {
        const n = v == null ? 0 : Math.round(Math.max(0, Math.min(1, (v - g.bar[0]) / (g.bar[1] - g.bar[0]))) * 18);
        $$('#gb' + g.k + ' i').forEach((e, i) => { const c = i >= n ? '' : g.grad ? (i < 9 ? '#2fd18b' : i < 13 ? '#d6e033' : i < 15 ? '#ffb020' : '#ff4d5e') : g.col; e.style.background = c; e.style.boxShadow = c ? '0 0 6px ' + c : ''; });
      }
    }
  }

  /* ================= GRAPH ================= */
  const GS = [
    { k: 'RPM', col: '#ff4d5e', lo: 0, hi: 12000, d: 0 }, { k: 'TPS', col: '#4d8dff', lo: 0, hi: 100, d: 1 },
    { k: 'SPD', l: 'GPS', col: '#2fd18b', lo: 0, hi: 200, d: 0 }, { k: 'AFR', col: '#ffc233', lo: 10, hi: 18, d: 1 },
  ];
  const gbuf = []; let gpause = false; const gmm = {};
  $('#gcards').innerHTML = GS.map((g) => `<div class="card gc" style="--c:${g.col}"><div class="gh"><span id="gl${g.k}">${g.l || g.k}</span><span class="spark">⟋</span></div><div class="gv" id="gg${g.k}">--</div><div class="mm"><span class="lo" id="gn${g.k}">▼ --</span><span class="hi" id="gx${g.k}">▲ --</span></div></div>`).join('');
  $('#gPause').onclick = () => { gpause = !gpause; $('#gPause').textContent = gpause ? '▶ เดินกราฟ' : '⏸ หยุดกราฟ'; };
  $('#gReset').onclick = () => { for (const k in gmm) delete gmm[k]; renderGraphCards(); };
  function graphPush(d) {
    const s = { t: d.t || Date.now(), RPM: d.RPM, TPS: d.TPS, SPD: d.GPS != null ? d.GPS : d.SPD, AFR: d.AFR };
    if (!gpause) { gbuf.push(s); while (gbuf.length && s.t - gbuf[0].t > 31000) gbuf.shift(); }
    for (const g of GS) { const v = s[g.k]; if (v == null) continue; const m = gmm[g.k] || (gmm[g.k] = { lo: v, hi: v, v }); m.v = v; m.lo = Math.min(m.lo, v); m.hi = Math.max(m.hi, v); }
    $('#glSPD').textContent = d.GPS != null ? 'GPS' : 'SPD';
  }
  function renderGraphCards() {
    for (const g of GS) {
      const m = gmm[g.k];
      $('#gg' + g.k).textContent = m ? (+m.v).toFixed(g.d) : '--';
      $('#gn' + g.k).textContent = '▼ ' + (m ? (+m.lo).toFixed(g.d) : '--'); $('#gx' + g.k).textContent = '▲ ' + (m ? (+m.hi).toFixed(g.d) : '--');
    }
  }
  function drawGraph() {
    const cv = $('#gcv'), box = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.max(50, box.width - 2), Hh = Math.max(50, box.height - 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); cv.style.width = W + 'px'; cv.style.height = Hh + 'px'; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    const pad = 12, top = 10, bot = Hh - 26;
    g.strokeStyle = '#1c3358'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = top + (bot - top) * i / 4; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke(); }
    if (!gbuf.length) { g.fillStyle = '#7d93b8'; g.font = '14px Kanit, sans-serif'; g.fillText('ยังไม่มีข้อมูลสด — กด LIVE หรือเปิด DEMO', pad + 6, top + 24); return; }
    const tEnd = gbuf[gbuf.length - 1].t, span = 30000;
    for (const s of GS) {
      g.strokeStyle = s.col; g.lineWidth = 2.6; g.shadowColor = s.col; g.shadowBlur = 8; g.beginPath(); let on = false;
      for (const p of gbuf) {
        const v = p[s.k]; if (v == null) { on = false; continue; }
        const x = pad + (W - 2 * pad) * (1 - (tEnd - p.t) / span), y = bot - (bot - top) * Math.max(0, Math.min(1, (v - s.lo) / (s.hi - s.lo)));
        if (on) g.lineTo(x, y); else { g.moveTo(x, y); on = true; }
      }
      g.stroke(); g.shadowBlur = 0;
    }
  }

  /* ================= AXES: which axis is RPM, its scale, load = TPS/MAP ================= */
  const axKey = (t) => 'jht.axes.' + (t ? t.title + '@' + t.z.addr : 'default');
  const amax = (a) => Math.max(...a.map((v) => Math.abs(v)));
  function axisInfo(t, xs, ys) {
    const o = LSget(axKey(t), {}), rx = amax(xs), ry = amax(ys);
    const rpmRows = o.rpm === 'rows' ? true : o.rpm === 'cols' ? false : ry >= 500 ? true : rx >= 500 ? false : ry >= rx;
    const rpmAx = rpmRows ? ys : xs, loadAx = rpmRows ? xs : ys, m = amax(rpmAx);
    const mul = +o.mul || (m >= 500 ? 1 : m >= 40 ? 100 : m >= 4 ? 1000 : 1);   // e.g. axis 98 → 9800 rpm
    const load = o.load || (amax(loadAx) <= 105 ? 'TPS' : 'MAP');
    return { rpmRows, mul, load, manual: !!(o.rpm || o.mul || o.load), scaled: mul !== 1 && !o.mul, unit: load === 'TPS' ? '%' : 'kPa' };
  }
  const fmtRpm = (v) => Math.round(v).toLocaleString('en-US');
  // axis labels in real units
  const rowLab = (info, v) => (info.rpmRows ? fmtRpm(v * info.mul) : fmtAx(v));
  const colLab = (info, v) => (info.rpmRows ? fmtAx(v) : fmtRpm(v * info.mul));
  const cornerLab = (info) => (info.rpmRows ? `RPM↓ / ${info.load}→` : `${info.load}↓ / RPM→`);
  // where the engine is now, as fractional row/col
  function livePos(info, xs, ys, d) {
    d = d || last;
    if (d.RPM == null) return null;
    const rpm = d.RPM / info.mul, ld = info.load === 'MAP' ? d.MAP : d.TPS;
    if (ld == null) return null;
    const fr = T.axisPos(ys, info.rpmRows ? rpm : ld), fc = T.axisPos(xs, info.rpmRows ? ld : rpm);
    if (fr == null || fc == null) return null;
    return { fr, fc, r: Math.round(fr), c: Math.round(fc), rpm: d.RPM, ld };
  }
  const bilerp = (V, fr, fc) => { const r0 = Math.floor(fr), c0 = Math.floor(fc), r1 = Math.min(r0 + 1, V.length - 1), c1 = Math.min(c0 + 1, V[0].length - 1), a = fr - r0, b = fc - c0;
    return (V[r0][c0] * (1 - b) + V[r0][c1] * b) * (1 - a) + (V[r1][c0] * (1 - b) + V[r1][c1] * b) * a; };

  // running cursor: crosshair lines + dot + label over a table inside a scroll box
  function Cursor(wrap, tab) {
    const el = document.createElement('div'); el.className = 'xcur'; el.hidden = true;
    el.innerHTML = '<i class="xh"></i><i class="xv"></i><b class="xd"></b><span class="xl"></span>';
    wrap.appendChild(el);
    const H = el.querySelector('.xh'), V = el.querySelector('.xv'), D = el.querySelector('.xd'), L = el.querySelector('.xl');
    let lastKey = null;
    return {
      hide() { el.hidden = true; tab.querySelectorAll('.curh').forEach((e) => e.classList.remove('curh')); tab.querySelectorAll('td.live').forEach((e) => e.classList.remove('live')); lastKey = null; },
      show(p, label, userT) {
        if (!p || !tab.rows.length) return this.hide();
        const R = tab.rows.length - 1, Cn = tab.rows[0].cells.length - 1;
        const fr = Math.max(0, Math.min(R - 1, p.fr)), fc = Math.max(0, Math.min(Cn - 1, p.fc));
        const cell = (r, c) => tab.rows[r + 1] && tab.rows[r + 1].cells[c + 1];
        const tr = tab.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
        const ctr = (r, c) => { const b = cell(r, c).getBoundingClientRect(); return { x: b.left - tr.left + b.width / 2, y: b.top - tr.top + b.height / 2 }; };
        const r0 = Math.floor(fr), c0 = Math.floor(fc), r1 = Math.min(r0 + 1, R - 1), c1 = Math.min(c0 + 1, Cn - 1);
        const A = ctr(r0, c0), B = ctr(r1, c1), x = A.x + (B.x - A.x) * (fc - c0), y = A.y + (B.y - A.y) * (fr - r0);
        const head = tab.rows[0].getBoundingClientRect().height, side = tab.rows[0].cells[0].getBoundingClientRect().width;
        el.hidden = false;
        el.style.left = (tr.left - wr.left + wrap.scrollLeft) + 'px'; el.style.top = (tr.top - wr.top + wrap.scrollTop) + 'px';
        el.style.width = tr.width + 'px'; el.style.height = tr.height + 'px';
        H.style.left = side + 'px'; H.style.width = (tr.width - side) + 'px'; H.style.transform = `translateY(${y}px)`;
        V.style.top = head + 'px'; V.style.height = (tr.height - head) + 'px'; V.style.transform = `translateX(${x}px)`;
        D.style.transform = `translate(${x}px,${y}px)`;
        L.textContent = label; const flip = x > tr.width - 200;
        L.style.transform = `translate(${flip ? x - 14 : x + 14}px,${y - 34}px)` + (flip ? ' translateX(-100%)' : '');
        // highlight the row / column headers and nearest cell
        const key = p.r + ',' + p.c;
        if (key !== lastKey) {
          lastKey = key;
          tab.querySelectorAll('.curh').forEach((e) => e.classList.remove('curh')); tab.querySelectorAll('td.live').forEach((e) => e.classList.remove('live'));
          const rr = Math.max(0, Math.min(R - 1, p.r)), cc = Math.max(0, Math.min(Cn - 1, p.c));
          tab.rows[0].cells[cc + 1].classList.add('curh'); tab.rows[rr + 1].cells[0].classList.add('curh'); cell(rr, cc).classList.add('live');
        }
        // keep it in view unless the user is scrolling/selecting
        if (Date.now() - (userT || 0) > 4000) {
          const vx = x + (tr.left - wr.left), vy = y + (tr.top - wr.top);
          if (vx < side + 20 || vx > wr.width - 30 || vy < head + 16 || vy > wr.height - 20)
            wrap.scrollTo({ left: Math.max(0, wrap.scrollLeft + vx - wr.width / 2), top: Math.max(0, wrap.scrollTop + vy - wr.height / 2), behavior: 'smooth' });
        }
      },
    };
  }

  /* ================= TUNE ================= */
  const tune = { file: null, base: null, buf: null, xdfName: '', tables: [], ti: 0, data: null, sel: null, anchor: null, range: false, undo: [], redo: [], clip: null, showAfr: false, view: '2d', live: true, liveCell: null, yaw: -0.75, pitch: 0.62, zoom: 1.3 };
  window.JetTune = tune;
  const cur = () => tune.tables[tune.ti] || null;
  const tSize = (t) => T.cellAddr(t.z, t.z.rows - 1, t.z.cols - 1) + t.z.bits / 8;
  const fitsBin = (t) => tune.buf && tSize(t) <= tune.buf.length && t.z.addr >= 0;
  function serDefs(tabs) { return tabs.map((t) => JSON.parse(JSON.stringify(t, (k, v) => (k === 'eq' ? undefined : v)))); }
  function reviveDefs(arr) { return (arr || []).map((t) => { t.z.eq = T.makeEq(t.z.eqText); if (t.x) t.x.eq = T.makeEq(t.x.eqText); if (t.y) t.y.eq = T.makeEq(t.y.eqText); return t; }); }
  // restore last XDF / manual tables
  (function restoreDefs() {
    const x = LSget('jht.xdf', null);
    if (x && x.text) { try { tune.tables = T.parseXDF(x.text); tune.xdfName = x.name; } catch (e) { /* ignore */ } }
    const man = reviveDefs(LSget('jht.tdefs', []));
    tune.tables = tune.tables.concat(man);
  })();

  function setTables(tabs, name, xdfText) {
    tune.tables = tabs.concat(reviveDefs(LSget('jht.tdefs', []))); tune.xdfName = name; tune.ti = 0;
    if (xdfText != null && !LSset('jht.xdf', { name, text: xdfText })) toast('XDF ใหญ่เกิน จำไว้ไม่ได้ — ต้องโหลดใหม่ทุกครั้งที่เปิดแอป', 4000);
    fillMaps(); loadTable();
  }
  function fillMaps() {
    $('#tMap').innerHTML = tune.tables.length ? tune.tables.map((t, i) => `<option value="${i}">${esc(t.title)} ${t.z.rows}×${t.z.cols}${tune.buf && !fitsBin(t) ? ' ⚠เกินไฟล์' : ''}</option>`).join('') : '<option>— ยังไม่มีตาราง —</option>';
    $('#tMap').value = tune.ti;
    $('#tBin').textContent = 'BIN: ' + (tune.file ? tune.file.name : '—') + (tune.undo.length ? ' *' : '');
    $('#tXdf').textContent = 'XDF: ' + (tune.xdfName || '—');
  }
  $('#tMap').onchange = () => { tune.ti = +$('#tMap').value; tune.sel = null; loadTable(); };
  function loadTable() {
    const t = cur();
    tune.data = t && fitsBin(t) ? T.readTable(tune.buf, t) : null;
    tune.info = tune.data ? axisInfo(t, tune.data.xs, tune.data.ys) : null;
    afrAxesChanged(true);
    renderTune();
  }
  function setBin(f) {
    tune.file = f; tune.base = new Uint8Array(C.fbytes(f)); tune.buf = new Uint8Array(tune.base); tune.undo = []; tune.redo = []; tune.sel = null;
    fillMaps(); loadTable();
  }
  FH.push((files) => {
    if (tune.file && !files.find((f) => f.id === tune.file.id)) { tune.file = null; tune.buf = null; tune.data = null; fillMaps(); renderTune(); }
    if (!tune.file && files.length) setBin(files[0]);
  });

  const EMPTY = $('#tEmpty').innerHTML;
  const heat = (n) => `hsl(${Math.round(232 * (1 - n))},88%,${54 + 6 * Math.sin(n * 3.14)}%)`;
  const fmtAx = (v) => (Math.abs(v) >= 100 ? Math.round(v) : +(+v).toFixed(1));
  const inSel = (r, c) => tune.sel && r >= tune.sel.r0 && r <= tune.sel.r1 && c >= tune.sel.c0 && c <= tune.sel.c1;
  function renderTune() {
    fillMaps();
    const t = cur(), d = tune.data, tab = $('#mtab'), cv = $('#t3c');
    $('#tEmpty').style.display = d ? 'none' : '';
    if (!d) { tab.innerHTML = ''; cv.hidden = true; $('#tEmpty').innerHTML = EMPTY; if (tune.file && t && !fitsBin(t)) $('#tEmpty').innerHTML = `ตาราง "${esc(t.title)}" อยู่ที่ ${P.hx(t.z.addr, 5)} เกินขนาดไฟล์ ${tune.file.name} — XDF ไม่ตรงกับไฟล์นี้`; return; }
    tab.hidden = tune.view === '3d'; cv.hidden = tune.view !== '3d';
    $('#t3d').textContent = tune.view === '3d' ? '2D' : '3D'; $('#t3d').classList.toggle('on', tune.view === '3d');
    $('#tAfr').classList.toggle('on', tune.showAfr); $('#tLive').classList.toggle('on', tune.live); $('#tRange').classList.toggle('on', tune.range);
    if (tune.view === '3d') { draw3d(); updSelInfo(); return; }
    let mn = Infinity, mx = -Infinity; for (const row of d.vals) for (const v of row) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const dec = Math.min(4, Math.max(0, t.z.dec == null ? 2 : t.z.dec));
    const baseT = T.readTable(tune.base, t).vals;
    const I = tune.info;
    let h = `<thead><tr><th class="corner" title="${t.z.rows}×${t.z.cols}">${cornerLab(I)}</th>${d.xs.map((x, c) => `<th class="xh" data-c="${c}">${colLab(I, x)}</th>`).join('')}</tr></thead><tbody>`;
    for (let r = 0; r < t.z.rows; r++) {
      h += `<tr><th class="yh" data-r="${r}">${rowLab(I, d.ys[r])}</th>`;
      for (let c = 0; c < t.z.cols; c++) {
        const v = d.vals[r][c]; let txt = v.toFixed(dec), bg = heat(mx > mn ? (v - mn) / (mx - mn) : 0.5), cls = '';
        if (tune.showAfr && afr.log) { const a = afr.log.get(r, c); if (a) { txt = a.avg.toFixed(1); bg = afrColor(a.avg); cls += ' afrv'; } else cls += ' dim'; }
        if (inSel(r, c)) cls += ' sel';
        if (Math.abs(v - baseT[r][c]) > 1e-9) cls += ' chg';
        h += `<td data-r="${r}" data-c="${c}" class="${cls}" style="background:${bg}">${txt}</td>`;
      }
      h += '</tr>';
    }
    tab.innerHTML = h + '</tbody>';
    tune.liveCell = null; markLive(true); updSelInfo(); axisNote();
  }
  function updSelInfo() {
    const s = tune.sel, d = tune.data;
    if (!s || !d) { $('#tSelInfo').textContent = tune.range && tune.anchor ? 'แตะช่องสุดท้ายของช่วง' : ''; return; }
    let n = 0, sum = 0, mn = Infinity, mx = -Infinity;
    for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) { const v = d.vals[r][c]; n++; sum += v; mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const I = tune.info;
    $('#tSelInfo').textContent = n === 1 ? `ช่อง [${rowLab(I, d.ys[s.r0])}, ${colLab(I, d.xs[s.c0])}] = ${+mn.toFixed(4)}` : `เลือก ${n} ช่อง · min ${+mn.toFixed(3)} · max ${+mx.toFixed(3)} · เฉลี่ย ${+(sum / n).toFixed(3)}`;
  }
  // ---- selection
  const rect = (a, b) => ({ r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) });
  let drag = null, dragMoved = false;
  $('#mtab').addEventListener('pointerdown', (e) => {
    const td = e.target.closest('td'); if (!td || e.pointerType !== 'mouse') return;
    drag = { r: +td.dataset.r, c: +td.dataset.c }; dragMoved = false;
  });
  $('#mtab').addEventListener('pointermove', (e) => {
    if (!drag) return; const td = document.elementFromPoint(e.clientX, e.clientY); const c = td && td.closest && td.closest('#mtab td');
    if (c && (+c.dataset.r !== drag.r || +c.dataset.c !== drag.c || dragMoved)) { dragMoved = true; tune.sel = rect(drag, { r: +c.dataset.r, c: +c.dataset.c }); paintSel(); }
  });
  window.addEventListener('pointerup', () => { drag = null; });
  $('#mtab').addEventListener('click', (e) => {
    const td = e.target.closest('td'), th = e.target.closest('th'), t = cur(); if (!t || !tune.data) return;
    if (td) {
      if (dragMoved) { dragMoved = false; return; }   // end of a mouse drag-selection
      const p = { r: +td.dataset.r, c: +td.dataset.c };
      if (tune.range && tune.anchor) { tune.sel = rect(tune.anchor, p); tune.anchor = null; }
      else { tune.sel = rect(p, p); tune.anchor = tune.range ? p : null; }
      paintSel();
    } else if (th) {
      if (th.classList.contains('xh')) { const c = +th.dataset.c; tune.sel = { r0: 0, r1: t.z.rows - 1, c0: c, c1: c }; }
      else if (th.classList.contains('yh')) { const r = +th.dataset.r; tune.sel = { r0: r, r1: r, c0: 0, c1: t.z.cols - 1 }; }
      else tune.sel = { r0: 0, r1: t.z.rows - 1, c0: 0, c1: t.z.cols - 1 };
      paintSel();
    }
  });
  $('#mtab').addEventListener('dblclick', async (e) => {
    const td = e.target.closest('td'); if (!td) return;
    const r = +td.dataset.r, c = +td.dataset.c; tune.sel = rect({ r, c }, { r, c }); paintSel();
    const I = tune.info;
    const v = await C.askText(`ค่าใหม่ของช่อง ${rowLab(I, tune.data.ys[r])} · ${colLab(I, tune.data.xs[c])}`, String(+tune.data.vals[r][c].toFixed(4)));
    if (v != null && v !== '' && !isNaN(+v)) applyFn(() => +v);
  });
  function paintSel() {
    $$('#mtab td.sel').forEach((e) => e.classList.remove('sel'));
    if (tune.sel) for (let r = tune.sel.r0; r <= tune.sel.r1; r++) for (let c = tune.sel.c0; c <= tune.sel.c1; c++) { const e = $(`#mtab td[data-r="${r}"][data-c="${c}"]`); if (e) e.classList.add('sel'); }
    updSelInfo();
  }
  $('#tRange').onclick = () => { tune.range = !tune.range; tune.anchor = null; $('#tRange').classList.toggle('on', tune.range); toast(tune.range ? 'โหมดช่วง: แตะช่องแรก แล้วแตะช่องสุดท้าย' : 'ปิดโหมดช่วง'); };

  // ---- editing with undo (stores raw values → exact undo)
  function commit(cells) {   // cells: [{r,c,v}]
    const t = cur(), z = t.z, ch = [];
    for (const { r, c, v } of cells) {
      if (!isFinite(v)) continue;
      const a = T.cellAddr(z, r, c), old = T.rawGet(tune.buf, z, a);
      T.rawSet(tune.buf, z, a, T.toRaw(z, v));
      const nw = T.rawGet(tune.buf, z, a);
      if (nw !== old) ch.push({ a, old, nw });
    }
    if (!ch.length) { toast('ค่าไม่เปลี่ยน (อาจชนขอบค่าสูงสุด/ต่ำสุด)'); return 0; }
    tune.undo.push({ ti: tune.ti, ch }); tune.redo = [];
    tune.data = T.readTable(tune.buf, t); renderTune();
    return ch.length;
  }
  function applyFn(fn) {
    const s = tune.sel, d = tune.data; if (!s || !d) { toast('เลือกช่องก่อน'); return; }
    const cells = []; for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) cells.push({ r, c, v: fn(d.vals[r][c], r, c) });
    commit(cells);
  }
  function undoRedo(from, to, useOld) {
    const e = from.pop(); if (!e) return toast(useOld ? 'ไม่มีอะไรให้ย้อน' : 'ไม่มีอะไรให้ทำซ้ำ');
    const t = tune.tables[e.ti]; for (const x of e.ch) T.rawSet(tune.buf, t.z, x.a, useOld ? x.old : x.nw);
    to.push(e); tune.ti = e.ti; tune.data = T.readTable(tune.buf, t); renderTune();
  }
  $('#tUndo').onclick = () => undoRedo(tune.undo, tune.redo, true);
  $('#tRedo').onclick = () => undoRedo(tune.redo, tune.undo, false);
  $('#tCopy').onclick = () => {
    const s = tune.sel, d = tune.data; if (!s || !d) return toast('เลือกช่องก่อน');
    tune.clip = []; for (let r = s.r0; r <= s.r1; r++) { const row = []; for (let c = s.c0; c <= s.c1; c++) row.push(d.vals[r][c]); tune.clip.push(row); }
    toast(`คัดลอก ${tune.clip.length}×${tune.clip[0].length} ช่อง`);
  };
  $('#tPaste').onclick = () => {
    const s = tune.sel, t = cur(); if (!tune.clip) return toast('ยังไม่ได้ COPY'); if (!s) return toast('เลือกช่องมุมซ้ายบนที่จะวาง');
    const cells = []; tune.clip.forEach((row, i) => row.forEach((v, j) => { const r = s.r0 + i, c = s.c0 + j; if (r < t.z.rows && c < t.z.cols) cells.push({ r, c, v }); }));
    if (commit(cells)) toast('วางแล้ว ' + cells.length + ' ช่อง');
  };
  $('#tRevert').onclick = async () => {
    if (!tune.buf || !tune.undo.length) return toast('ยังไม่มีการแก้');
    if (!(await C.ask('ยกเลิกการแก้ทั้งหมดในไฟล์นี้?', true))) return;
    tune.buf = new Uint8Array(tune.base); tune.undo = []; tune.redo = []; loadTable();
  };
  $('#tSave').onclick = async () => {
    if (!tune.file || !tune.buf) return toast('ยังไม่ได้เปิดไฟล์');
    if (!tune.undo.length) return toast('ยังไม่มีการแก้');
    const lay = P.detectLayout(tune.buf, tune.file);
    let out = tune.buf;
    try { if (!P.binChecksumOK(out)) out = P.binFixChecksum(out, lay.cks); } catch (e) { return toast('แก้ checksum ไม่ได้: ' + e.message); }
    const base = tune.file.name.replace(/_T\d+$/, ''), n = (C.st.files.filter((f) => f.name.startsWith(base + '_T')).length || 0) + 1;
    const name = await C.askText('ชื่อไฟล์ใหม่ (checksum แก้ให้แล้ว)', base + '_T' + n);
    if (!name) return;
    const keep = { readStart: tune.file.readStart, startManual: tune.file.startManual, cksManual: tune.file.cksManual };
    const f = await C.addFile(name, out, Object.assign({ origin: 'tune' }, keep));
    setBin(f);
    toast('บันทึก "' + name + '" แล้ว — ไปหน้า "อัดไฟล์" เพื่ออัดลงกล่อง', 5000);
  };

  // ---- adjust popover
  $('#tAdj').onclick = () => { const p = $('#tAdjPop'); p.hidden = !p.hidden; if (!p.hidden) { $('#tAdjHint').textContent = tune.sel ? '' : 'เลือกช่องในตารางก่อน'; $('#tVal').focus(); } };
  $$('#tAdjPop [data-op]').forEach((b) => b.onclick = () => {
    const op = b.dataset.op, v = parseFloat($('#tVal').value), s = tune.sel, d = tune.data;
    if (op === 'close') { $('#tAdjPop').hidden = true; return; }
    if (!s || !d) return toast('เลือกช่องก่อน');
    const need = ['set', 'add', 'sub', 'pct+', 'pct-', 'mul'].includes(op);
    if (need && isNaN(v)) return toast('ใส่ตัวเลขก่อน');
    if (op === 'set') applyFn(() => v);
    else if (op === 'add') applyFn((x) => x + v);
    else if (op === 'sub') applyFn((x) => x - v);
    else if (op === 'pct+') applyFn((x) => x * (1 + v / 100));
    else if (op === 'pct-') applyFn((x) => x * (1 - v / 100));
    else if (op === 'mul') applyFn((x) => x * v);
    else if (op === 'smooth') {
      const V = d.vals; applyFn((x, r, c) => { let n = 0, sm = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const rr = r + i, cc = c + j; if (rr >= s.r0 && rr <= s.r1 && cc >= s.c0 && cc <= s.c1) { n++; sm += V[rr][cc]; } } return sm / n; });
    } else if (op === 'interp') {
      const V = d.vals, a = V[s.r0][s.c0], b = V[s.r0][s.c1], c2 = V[s.r1][s.c0], e = V[s.r1][s.c1];
      applyFn((x, r, c) => { const u = s.c1 > s.c0 ? (c - s.c0) / (s.c1 - s.c0) : 0, w = s.r1 > s.r0 ? (r - s.r0) / (s.r1 - s.r0) : 0; return (a * (1 - u) + b * u) * (1 - w) + (c2 * (1 - u) + e * u) * w; });
    }
  });

  // ---- AFR overlay / FIT
  $('#tAfr').onclick = () => { tune.showAfr = !tune.showAfr; renderTune(); if (tune.showAfr && (!afr.log || !afr.log.filled())) toast('ยังไม่มี AFR log — เปิด REC ที่หน้า AFR แล้ววิ่งเก็บค่าก่อน', 4000); };
  $('#tFit').onclick = async () => {
    const t = cur(), d = tune.data; if (!t || !d) return toast('เปิดตารางก่อน');
    if (!afr.log || !afr.log.filled()) return toast('ยังไม่มี AFR log ของตารางนี้ — ไปหน้า AFR แล้วกด REC เก็บค่าก่อน', 4500);
    if (!T.isFuel(t) && !(await C.ask(`"${t.title}" อาจไม่ใช่ตารางน้ำมัน — ใช้ FIT ต่อ?`, true))) return;
    const s = tune.sel || { r0: 0, r1: t.z.rows - 1, c0: 0, c1: t.z.cols - 1 }, cfg = { cruise: +S.afrCruise || 14.2, wot: +S.afrWot || 12.8, wotTps: +S.afrWotTps || 50 };
    const I = tune.info;
    const cells = []; let sumPct = 0;
    for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) {
      const a = afr.log.get(r, c); if (!a || a.n < (+S.fitMinN || 3)) continue;
      const ld = I.rpmRows ? d.xs[c] : d.ys[r];
      const tgt = I.load === 'TPS' ? T.afrTarget(ld, cfg) : (ld >= 85 ? cfg.wot : cfg.cruise), f = T.fitFactor(a.avg, tgt, +S.fitMax || 15);
      cells.push({ r, c, v: d.vals[r][c] * f }); sumPct += (f - 1) * 100;
    }
    if (!cells.length) return toast(`ไม่มีช่องที่มี AFR ≥ ${+S.fitMinN || 3} ครั้งในช่วงที่เลือก`);
    const msg = `FIT จะแก้ ${cells.length} ช่อง เฉลี่ย ${sumPct >= 0 ? '+' : ''}${(sumPct / cells.length).toFixed(1)}% (เป้า AFR เดินทาง ${cfg.cruise} · เต็มคันเร่ง ${cfg.wot}, จำกัด ±${+S.fitMax || 15}%/ครั้ง) — ทำต่อ?`;
    if (!(await C.ask(msg))) return;
    const n = commit(cells); if (n) toast('FIT แล้ว ' + n + ' ช่อง — กด ↶ เพื่อย้อนได้');
  };
  $('#tAxis').onclick = () => {
    const p = $('#tAxisPop'); p.hidden = !p.hidden; if (p.hidden) return;
    const o = LSget(axKey(cur()), {}); $('#axRpm').value = o.rpm || ''; $('#axMul').value = o.mul || ''; $('#axLoad').value = o.load || '';
    const I = tune.info; $('#axNow').textContent = I ? `ตอนนี้: รอบอยู่${I.rpmRows ? 'แนวตั้ง (แถว)' : 'แนวนอน (คอลัมน์)'} · ×${I.mul} · โหลด = ${I.load}` : 'ยังไม่ได้เปิดตาราง';
  };
  $$('#tAxisPop select').forEach((el) => el.onchange = () => {
    const t = cur(); if (!t) return;
    const o = { rpm: $('#axRpm').value || undefined, mul: +$('#axMul').value || undefined, load: $('#axLoad').value || undefined };
    LSset(axKey(t), o); tune.warned = true; loadTable(); $('#tAxis').click(); $('#tAxis').click();
  });
  $('#axClose').onclick = () => { $('#tAxisPop').hidden = true; };
  $('#t3d').onclick = () => { tune.view = tune.view === '3d' ? '2d' : '3d'; renderTune(); };
  $('#tLive').onclick = () => { tune.live = !tune.live; renderTune(); };

  // ---- live cell
  const tCur = Cursor($('#twrap'), $('#mtab'));
  const fresh = () => last.RPM != null && Date.now() - (last.t || 0) < 3000;
  function liveRC(d0, xs, ys) { return d0 && tune.info && fresh() ? livePos(tune.info, xs, ys) : null; }
  function markLive() {
    const d = tune.data; if (!d) { tCur.hide(); return; }
    const p = liveRC(d, d.xs, d.ys), I = tune.info;
    $('#tLiveInfo').textContent = p ? `● ${fmtRpm(p.rpm)} rpm · ${I.load} ${(+p.ld).toFixed(1)} · ${rowLab(I, d.ys[p.r])}/${colLab(I, d.xs[p.c])}` : (last.RPM != null ? 'ไม่มีข้อมูลสด' : '');
    if (tune.view === '3d') { tCur.hide(); if (curTab === 'Tune') draw3d(); return; }
    if (!p || !tune.live || curTab !== 'Tune') { if (!p || !tune.live) tCur.hide(); return; }
    const v = bilerp(d.vals, Math.max(0, Math.min(d.vals.length - 1, p.fr)), Math.max(0, Math.min(d.vals[0].length - 1, p.fc)));
    tCur.show(p, `${fmtRpm(p.rpm)} rpm · ${I.load} ${(+p.ld).toFixed(1)}${I.unit} → ${(+v).toFixed(3)}`, drag ? Date.now() : tune.userT);
  }
  function axisNote() {
    const I = tune.info; if (!I) return;
    if (I.scaled && !tune.warned) { tune.warned = true; toast(`แกนรอบในไฟล์ถูกย่อ — แสดงเป็น ×${I.mul} ให้แล้ว (ตรวจ/แก้ได้ที่ปุ่ม "แกน")`, 4500); }
  }

  // ---- 3D surface
  function draw3d() {
    const cv = $('#t3c'), d = tune.data, t = cur(); if (!d || !t) return;
    const box = $('#twrap').getBoundingClientRect(), dpr = window.devicePixelRatio || 1, W = box.width - 4, Hh = box.height - 4;
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    const R = t.z.rows, Cc = t.z.cols; let mn = Infinity, mx = -Infinity; for (const row of d.vals) for (const v of row) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const zn = (v) => (mx > mn ? (v - mn) / (mx - mn) : 0.5);
    const cy = Math.cos(tune.yaw), sy = Math.sin(tune.yaw), cp = Math.cos(tune.pitch), sp = Math.sin(tune.pitch);
    const raw = (c, r, v) => { const x = c / (Cc - 1) - 0.5, y = 0.5 - r / (R - 1), z = zn(v) * 0.55; const X = x * cy - y * sy, Y = x * sy + y * cy; return { x: X, y: Y * sp - z * cp, d: Y * cp + z * sp }; };
    // auto-fit the projected surface into the canvas (then apply user zoom)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let r = 0; r < R; r += Math.max(1, R - 1)) for (let c = 0; c < Cc; c += Math.max(1, Cc - 1)) for (const v of [mn, mx]) { const q = raw(c, r, v); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const mL = 40, mT = 30, sc = Math.min((W - 2 * mL) / (x1 - x0 || 1), (Hh - mT - 30) / (y1 - y0 || 1)) * tune.zoom;
    const ox = W / 2 - ((x0 + x1) / 2) * sc, oy = mT + (Hh - mT - 30) / 2 - ((y0 + y1) / 2) * sc;
    const prj = (c, r, v) => { const q = raw(c, r, v); return { x: ox + q.x * sc, y: oy + q.y * sc, d: q.d }; };
    const P2 = []; for (let r = 0; r < R; r++) { P2.push([]); for (let c = 0; c < Cc; c++) P2[r].push(prj(c, r, d.vals[r][c])); }
    const quads = [];
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < Cc - 1; c++) { const q = [P2[r][c], P2[r][c + 1], P2[r + 1][c + 1], P2[r + 1][c]]; quads.push({ q, d: (q[0].d + q[1].d + q[2].d + q[3].d) / 4, v: (d.vals[r][c] + d.vals[r][c + 1] + d.vals[r + 1][c] + d.vals[r + 1][c + 1]) / 4 }); }
    quads.sort((a, b) => b.d - a.d);
    for (const o of quads) { g.beginPath(); g.moveTo(o.q[0].x, o.q[0].y); for (let i = 1; i < 4; i++) g.lineTo(o.q[i].x, o.q[i].y); g.closePath(); g.fillStyle = heat(zn(o.v)); g.fill(); g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 0.7; g.stroke(); }
    g.fillStyle = '#9fb5da'; g.font = '12px Lexend, sans-serif';
    const a0 = prj(0, 0, mn), a1 = prj(Cc - 1, 0, mn), b1 = prj(0, R - 1, mn);
    const I = tune.info, xn = I.rpmRows ? I.load : 'RPM', yn = I.rpmRows ? 'RPM' : I.load;
    g.fillText(colLab(I, d.xs[0]), a0.x - 8, a0.y + 16); g.fillText(colLab(I, d.xs[Cc - 1]) + ' ' + xn, a1.x - 10, a1.y + 16); g.fillText(rowLab(I, d.ys[R - 1]) + ' ' + yn, b1.x - 40, b1.y + 14);
    g.fillText(`${t.title} · ${+mn.toFixed(2)} – ${+mx.toFixed(2)}`, 12, 18);
    const p = liveRC(d, d.xs, d.ys);
    if (p && tune.live) { const r = Math.min(R - 1, Math.max(0, p.r)), c = Math.min(Cc - 1, Math.max(0, p.c)), q = P2[r][c], v = bilerp(d.vals, Math.max(0, Math.min(R - 1, p.fr)), Math.max(0, Math.min(Cc - 1, p.fc)));
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x, q.y + 70); g.stroke();
      g.fillStyle = '#ff3fd2'; g.beginPath(); g.arc(q.x, q.y, 7, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#d63fb8'; const lab = 'LIVE ' + (+v).toFixed(3); g.fillRect(q.x + 10, q.y - 28, g.measureText(lab).width + 16, 22); g.fillStyle = '#fff'; g.fillText(lab, q.x + 18, q.y - 13); }
  }
  ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach((ev) => $('#twrap').addEventListener(ev, () => { tune.userT = Date.now(); }, { passive: true }));
  let rot = null;
  const ptr = new Map(); let pinch = null;
  $('#t3c').addEventListener('pointerdown', (e) => {
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); $('#t3c').setPointerCapture(e.pointerId);
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: tune.zoom }; rot = null; }
    else rot = { x: e.clientX, y: e.clientY, yaw: tune.yaw, pitch: tune.pitch };
  });
  $('#t3c').addEventListener('pointermove', (e) => {
    if (ptr.has(e.pointerId)) ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptr.size === 2) { const [a, b] = [...ptr.values()]; tune.zoom = Math.max(0.5, Math.min(3, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / (pinch.d || 1))); draw3d(); return; }
    if (!rot) return; tune.yaw = rot.yaw + (e.clientX - rot.x) / 160; tune.pitch = Math.max(0.15, Math.min(1.45, rot.pitch + (e.clientY - rot.y) / 200)); draw3d();
  });
  const up = (e) => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = null; rot = null; };
  $('#t3c').addEventListener('pointerup', up); $('#t3c').addEventListener('pointercancel', up);
  $('#t3c').addEventListener('wheel', (e) => { e.preventDefault(); tune.zoom = Math.max(0.5, Math.min(2.5, tune.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); draw3d(); }, { passive: false });

  // ---- file / XDF / manual table modal
  const fm = document.createElement('div'); fm.className = 'modal'; fm.id = 'mTune';
  fm.innerHTML = `<div class="card" style="max-width:720px"><h2>ไฟล์ & ตาราง (TUNE)</h2>
    <div class="grid g2"><div><h3>1) เลือกไฟล์ .bin จากคลัง</h3><div class="flist" id="tfList" style="max-height:38vh"></div></div>
    <div><h3>2) นิยามตาราง</h3>
      <div class="row"><button class="btn pri" id="tfXdf">📄 โหลดไฟล์ XDF</button><input type="file" id="tfXdfIn" accept=".xdf,.XDF,.xml,text/xml" hidden></div>
      <div class="row" style="margin-top:8px"><button class="btn" id="tfDemo">ใช้ XDF ตัวอย่าง (DEMO)</button></div>
      <div class="row" style="margin-top:8px"><button class="btn" id="tfMan">➕ กำหนดตารางเอง</button><button class="btn red" id="tfManClr">ล้างตารางที่กำหนดเอง</button></div>
      <p class="mut" style="font-size:12.5px">XDF ปัจจุบัน: <b id="tfXdfName">—</b> · ${'${n}'} ตาราง</p></div></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>ปิด</button></div></div>`;
  document.body.appendChild(fm);
  fm.querySelector('[data-close]').onclick = () => C.modal('#mTune', false);
  fm.addEventListener('click', (e) => { if (e.target === fm) C.modal('#mTune', false); });
  function fillFileModal() {
    $('#tfList').innerHTML = st.files.length ? st.files.map((f) => `<div class="fi${tune.file && tune.file.id === f.id ? ' sel' : ''}" data-id="${f.id}"><span class="chip">▣</span><div><b>${esc(f.name)}</b><small>${C.kb(f.data.byteLength)}</small></div></div>`).join('') : '<div class="mut">คลังว่าง — ดูดไฟล์หรือนำเข้าที่หน้า "อัดไฟล์" ก่อน</div>';
    $$('#tfList .fi').forEach((el) => el.onclick = async () => {
      if (tune.undo.length && !(await C.ask('ไฟล์ปัจจุบันยังไม่ได้บันทึก — เปลี่ยนไฟล์และทิ้งการแก้?', true))) return;
      setBin(st.files.find((f) => f.id === el.dataset.id)); fillFileModal();
    });
    fm.querySelector('p.mut').innerHTML = `XDF ปัจจุบัน: <b>${esc(tune.xdfName || '—')}</b> · ${tune.tables.length} ตาราง`;
  }
  $('#tFile').onclick = () => { fillFileModal(); C.modal('#mTune', true); };
  $('#tfXdf').onclick = () => $('#tfXdfIn').click();
  $('#tfXdfIn').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const txt = await f.text(), tabs = T.parseXDF(txt);
      if (!tabs.length) return toast('ไม่พบตาราง (XDFTABLE) ในไฟล์นี้');
      setTables(tabs, f.name, txt); fillFileModal(); toast(`โหลด ${f.name}: ${tabs.length} ตาราง`);
    } catch (er) { toast('อ่าน XDF ไม่ได้: ' + er.message, 4000); }
  };
  $('#tfDemo').onclick = () => { setTables(T.parseXDF(P.DEMO_XDF), 'DEMO K03-H01.xdf', P.DEMO_XDF); fillFileModal(); toast('ใช้ XDF ตัวอย่าง — ตรงกับไฟล์ที่ดูดจากโหมด DEMO'); };
  $('#tfManClr').onclick = () => { LSset('jht.tdefs', []); setTables(tune.tables.filter((t) => !t.manual), tune.xdfName); fillFileModal(); };
  $('#tfMan').onclick = async () => {
    const q = async (m, d) => { const v = await C.askText(m, d); if (v == null) throw 0; return v.trim(); };
    try {
      const title = await q('ชื่อตาราง', 'Fuel');
      const addr = C.parseHex(await q('ตำแหน่งในไฟล์ (hex)', '0x4000'));
      const rc = (await q('ขนาด แถว×คอลัมน์ (เช่น 29x25)', '29x25')).toLowerCase().split(/[x×*, ]+/).map(Number);
      const typ = (await q('ชนิดข้อมูล: 8, 16 (big-endian), 16le, 16s (มีเครื่องหมาย)', '16')).toLowerCase();
      const eq = await q('สูตรแปลงค่า (ใช้ X) เช่น X*0.001', 'X');
      const ya = await q('แกน Y (RPM) ตำแหน่ง hex, ชนิด, สูตร — เว้นว่าง = 0,1,2…', '');
      const xa = await q('แกน X (TPS) ตำแหน่ง hex, ชนิด, สูตร — เว้นว่าง = 0,1,2…', '');
      const bits = parseInt(typ, 10) || 8, ax = (s, n) => { if (!s) return null; const [a, ty, ...e] = s.split(','); return { count: n, addr: C.parseHex(a), bits: parseInt(ty, 10) || 8, lsb: /le/.test(ty || ''), signed: /s/.test(ty || ''), eqText: (e.join(',') || 'X').trim(), labels: null }; };
      const def = { title: title + ' (เอง)', manual: true, z: { addr, rows: rc[0] || 1, cols: rc[1] || 1, bits, lsb: /le/.test(typ), signed: /s/.test(typ), eqText: eq || 'X', dec: 3 }, y: ax(ya, rc[0] || 1), x: ax(xa, rc[1] || 1) };
      const all = LSget('jht.tdefs', []); all.push(def); LSset('jht.tdefs', all);
      const keep = tune.tables.filter((t) => !t.manual);
      tune.tables = keep.concat(reviveDefs(JSON.parse(JSON.stringify(all)))); tune.ti = tune.tables.length - 1; fillMaps(); loadTable(); fillFileModal();
      toast('เพิ่มตาราง "' + def.title + '" แล้ว');
    } catch (e) { if (e !== 0) toast('ข้อมูลไม่ถูกต้อง'); }
  };

  /* ================= AFR LOG ================= */
  const DEF_Y = [840, 1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000, 2250, 2500, 2750, 3000, 3250, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 7750, 8000, 8500, 9000, 9500, 9800];
  const DEF_X = [0, 0.4, 0.8, 1.2, 1.9, 2.5, 3.0, 3.5, 4.0, 4.9, 5.9, 7.9, 9.9, 11.9, 13.9, 15.9, 18.6, 20.9, 26.4, 31.8, 39.5, 44.7, 50.0, 59.3, 72.0];
  const afr = { xs: DEF_X, ys: DEF_Y, title: 'ค่าเริ่มต้น', sig: '', log: null, dirty: false, rec: S.afrRec !== false };
  window.JetAfr = afr;
  const afrColor = (v) => { const stops = [[10.5, [210, 40, 60]], [11.5, [225, 70, 55]], [12.8, [215, 150, 40]], [14.0, [70, 190, 110]], [14.7, [40, 175, 120]], [15.6, [40, 130, 200]], [16.5, [70, 90, 220]], [18, [110, 70, 210]]];
    if (v <= stops[0][0]) return `rgb(${stops[0][1]})`; for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], k = (v - a) / (b - a); return `rgb(${ca.map((x, j) => Math.round(x + (cb[j] - x) * k))})`; } return `rgb(${stops[stops.length - 1][1]})`; };
  function afrAxesChanged(force) {
    const d = tune.data, t = cur();
    const xs = d ? d.xs : DEF_X, ys = d ? d.ys : DEF_Y, sig = ys.length + 'x' + xs.length + ':' + ys[0] + '-' + ys[ys.length - 1] + ':' + xs[0] + '-' + xs[xs.length - 1];
    afr.info = d ? tune.info : axisInfo(null, xs, ys);
    if (sig === afr.sig && afr.log) { afr.title = d ? t.title : 'ค่าเริ่มต้น (RPM × TPS)'; if (force && curTab === 'AFR') renderAfr(); return; }
    afrSave(); afr.xs = xs; afr.ys = ys; afr.sig = sig; afr.title = d ? t.title : 'ค่าเริ่มต้น (RPM × TPS)';
    const o = LSget('jht.afr.' + sig, null); afr.log = o ? T.AfrLog.from(o) : new T.AfrLog(ys.length, xs.length);
    if (curTab === 'AFR') renderAfr();
  }
  function afrSave() { if (afr.log && afr.dirty) { LSset('jht.afr.' + afr.sig, afr.log.toJSON()); afr.dirty = false; } }
  setInterval(afrSave, 5000);
  window.addEventListener('pagehide', afrSave);
  function afrRecord(d) {
    if (!afr.rec || d.AFR == null || d.RPM == null || !afr.log) return;
    const p = livePos(afr.info, afr.xs, afr.ys, d);
    if (!p) return;
    afr.log.add(p.fr, p.fc, d.AFR); afr.dirty = true;
  }
  function renderAfr() {
    if (!afr.log) afrAxesChanged();
    const L = afr.log, xs = afr.xs, ys = afr.ys;
    const I = afr.info;
    let h = `<thead><tr><th class="corner">${cornerLab(I)}</th>${xs.map((x) => `<th>${colLab(I, x)}</th>`).join('')}</tr></thead><tbody>`;
    for (let r = 0; r < ys.length; r++) {
      h += `<tr><th class="yh">${rowLab(I, ys[r])}</th>`;
      for (let c = 0; c < xs.length; c++) { const a = L.get(r, c); h += a ? `<td data-r="${r}" data-c="${c}" style="background:${afrColor(a.avg)};opacity:${Math.min(1, 0.45 + a.n / 10)}">${a.avg.toFixed(1)}</td>` : `<td data-r="${r}" data-c="${c}" class="empty"></td>`; }
      h += '</tr>';
    }
    $('#atab').innerHTML = h + '</tbody>';
    afrInfo(); afrLiveMark(true);
  }
  function afrInfo() {
    const live = last.AFR != null && Date.now() - (last.t || 0) < 3000;
    $('#aInfo').textContent = `${afr.ys.length}×${afr.xs.length} · แกนจาก "${afr.title}" · บันทึกแล้ว ${afr.log ? afr.log.filled() : 0} ช่อง · ${live ? 'AFR สด ' + (+last.AFR).toFixed(1) : 'ยังไม่มีข้อมูลสด (ต่อเกจ/เปิด DEMO)'}`;
    $('#aRec').classList.toggle('on', afr.rec); $('#aRec').textContent = afr.rec ? '● REC' : '○ REC';
  }
  const aWrap = $('#atab').parentElement, aCur = Cursor(aWrap, $('#atab'));
  ['pointerdown', 'wheel', 'touchstart'].forEach((ev) => aWrap.addEventListener(ev, () => { afr.userT = Date.now(); }, { passive: true }));
  function afrLiveMark() {
    const p = last.RPM != null && Date.now() - (last.t || 0) < 3000 ? livePos(afr.info, afr.xs, afr.ys) : null, I = afr.info;
    if (!p || curTab !== 'AFR') { if (!p) aCur.hide(); return; }
    aCur.show(p, `${fmtRpm(p.rpm)} rpm · ${I.load} ${(+p.ld).toFixed(1)}${I.unit}` + (last.AFR != null ? ` → AFR ${(+last.AFR).toFixed(1)}` : ''), afr.userT);
  }
  $('#atab').addEventListener('click', (e) => {
    const td = e.target.closest('td'); if (!td) return; const r = +td.dataset.r, c = +td.dataset.c, a = afr.log.get(r, c);
    const I = afr.info, where = `${rowLab(I, afr.ys[r])} · ${colLab(I, afr.xs[c])}`;
    toast(a ? `${where} → AFR เฉลี่ย ${a.avg.toFixed(2)} (min ${a.min.toFixed(1)} / max ${a.max.toFixed(1)}) · ${a.n} ครั้ง` : `${where} — ยังไม่มีข้อมูล`, 4000);
  });
  $('#aRec').onclick = () => { afr.rec = !afr.rec; S.afrRec = afr.rec; C.saveS(); afrInfo(); };
  $('#aClr').onclick = async () => { if (await C.ask('ล้าง AFR log ของแกนนี้ทั้งหมด?', true)) { afr.log.clear(); afr.dirty = true; afrSave(); renderAfr(); } };

  /* ================= DRAG LOG ================= */
  const dt = new T.DragTimer([201, 402, 500, 1000]);
  const drag2 = { runs: LSget('jht.drag', [null, null, null]), view: 0, last: null };
  $('#dSegs').innerHTML = Array.from({ length: 48 }, () => '<i></i>').join('') + '<div class="dticks">' + [0, 40, 80, 120, 160, 200, 240].map((v) => `<span>${v}</span>`).join('') + '</div>';
  function dragFeed(t, v) {
    if (v == null) return;
    drag2.last = { t, v };
    const res = dt.feed(t, v);
    if (dt.state === 'run' && drag2.runningSlot == null) { drag2.runningSlot = true; drag2.view = -1; }
    if (res) {
      const i = drag2.runs.findIndex((r) => !r); const slot = i >= 0 ? i : drag2.runs.reduce((m, r, k) => (r.at < drag2.runs[m].at ? k : m), 0);
      drag2.runs[slot] = res; drag2.view = slot; drag2.runningSlot = null; LSset('jht.drag', drag2.runs);
      toast(`จบรอบ: ${res.splits[402] ? '402m ' + res.splits[402].toFixed(3) + ' s · ' : ''}MAX ${res.maxV} km/h → RUN ${slot + 1}`, 5000);
    }
    if (dt.state === 'done' && v < 1.5) { if (!drag2.rearm) drag2.rearm = t; else if (t - drag2.rearm > 2000) { dt.reset(); dt.feed(t, v); drag2.rearm = null; } } else drag2.rearm = null;
  }
  $('#dReset').onclick = async () => { if (!(await C.ask('ล้างผลทั้ง 3 รอบ?', true))) return; drag2.runs = [null, null, null]; drag2.view = 0; dt.reset(); LSset('jht.drag', drag2.runs); renderDrag(); };
  $('#dSrc').onclick = () => {
    gps.src = { auto: 'gauge', gauge: 'phone', phone: 'auto' }[gps.src]; S.gpsSrc = gps.src; C.saveS();
    if (gps.src === 'gauge') gps.stopPhone(); else gps.ensurePhone(); renderDrag();
  };
  function renderDrag() {
    const g = gps.current(), running = dt.state === 'run';
    $('#dSrc').textContent = 'แหล่ง: ' + { auto: 'AUTO', gauge: 'เกจ', phone: 'มือถือ' }[gps.src];
    const bars = g ? (g.src === 'GAUGE' ? (g.sats >= 12 ? 3 : g.sats >= 7 ? 2 : 1) : (g.acc <= 5 ? 3 : g.acc <= 15 ? 2 : 1)) : 0;
    $$('#dSig i').forEach((e, i) => e.classList.toggle('on', i < bars));
    $('#dSat').textContent = g ? (g.src === 'GAUGE' ? `Satellites in use: ${g.sats} of ${g.satsView || '?'} (เกจ)` : `GPS มือถือ ±${Math.round(g.acc || 0)} m · ~1 ครั้ง/วินาที`) : (gps.err ? 'GPS: ' + gps.err : 'ยังไม่มีสัญญาณ GPS');
    $('#dSpdAcc').textContent = g ? `Speed ${Math.round(g.spd)} km/h` : '';
    const sEl = $('#dState'); sEl.textContent = !g ? 'NO GPS' : running ? 'RUNNING' : dt.state === 'done' ? 'DONE' : 'READY';
    sEl.className = 'dstate ' + (!g ? 'bad' : running ? 'run' : 'ok');
    const run = running || drag2.view < 0 ? { splits: dt.splits, speeds: dt.speeds, maxV: Math.round(dt.maxV), time: dt.elapsed, dist: dt.dist } : drag2.runs[drag2.view];
    const row = (lab, tm, sp) => `<tr><th>${lab}</th><td>${tm}</td><td>${sp}</td></tr>`;
    const R = run || { splits: {}, speeds: {} };
    $('#dTable').innerHTML = `<tr class="hd"><th>DIST</th><td>TIME</td><td>SPEED</td></tr>` +
      [201, 402, 500, 1000].map((m) => row(m + 'M', R.splits[m] != null ? R.splits[m].toFixed(4) + ' S' : '--', R.speeds[m] != null ? R.speeds[m] + ' KM/H' : '--')).join('') +
      row('0-100', R.speeds.v100 != null ? R.speeds.v100.toFixed(3) + ' S' : '--', '') + row('MAX SPEED', '', R.maxV ? R.maxV + ' KM/H' : '--');
    $('#dRuns').innerHTML = [0, 1, 2].map((i) => `<button class="${drag2.view === i ? 'on' : ''}" data-i="${i}">RUN ${i + 1}${drag2.runs[i] ? ' ●' : ''}</button>`).join('');
    $$('#dRuns button').forEach((b) => b.onclick = () => { drag2.view = +b.dataset.i; renderDrag(); });
    $('#dBig').textContent = (run ? (+run.time || 0) : 0).toFixed(4) + ' S';
    $('#dDist').textContent = (run ? Math.round(run.dist || 0) : 0) + ' m';
    const v = g ? g.spd : 0, n = Math.round(Math.max(0, Math.min(1, v / 240)) * 48);
    $$('#dSegs > i').forEach((e, i) => { const c = i >= n ? '' : i < 22 ? '#2fd18b' : i < 30 ? '#c9e033' : i < 38 ? '#ffb020' : '#ff4d5e'; e.style.background = c; e.style.boxShadow = c ? '0 0 6px ' + c : ''; });
    $('#dSv').textContent = Math.round(v) + ' KM/H';
  }

  /* ================= TOOLS sub-tabs ================= */
  let curSub = 'ee';
  function subShow(s) { curSub = s; $$('.subtabs button').forEach((b) => b.classList.toggle('on', b.dataset.sub === s)); $$('.sub').forEach((d) => (d.hidden = d.dataset.sub !== s)); if (s === 'hex') C.renderHex(); }
  $$('.subtabs button').forEach((b) => b.onclick = () => subShow(b.dataset.sub));

  /* ================= settings: AFR / FIT / GPS ================= */
  (function settings() {
    const card = $('#mSet .card'), anchor = card.querySelector('h3:last-of-type');
    const blk = document.createElement('div');
    blk.innerHTML = `<h3 style="margin-top:16px">TUNE / AFR / GPS</h3><div class="grid g3">
      <label class="f">AFR เป้า (เดินทาง)<input id="sAfrC" type="number" step="0.1"></label>
      <label class="f">AFR เป้า (เต็มคันเร่ง)<input id="sAfrW" type="number" step="0.1"></label>
      <label class="f">เต็มคันเร่งเมื่อ TPS ≥ (%)<input id="sAfrT" type="number"></label>
      <label class="f">FIT แก้ได้สูงสุด ±%/ครั้ง<input id="sFitM" type="number"></label>
      <label class="f">FIT ใช้ช่องที่มีข้อมูล ≥ (ครั้ง)<input id="sFitN" type="number"></label>
      <label class="f">แหล่ง GPS<select id="sGps"><option value="auto">AUTO (เกจก่อน)</option><option value="gauge">เกจเท่านั้น</option><option value="phone">มือถือเท่านั้น</option></select></label></div>`;
    card.insertBefore(blk, anchor);
    $('#bSet').addEventListener('click', () => { $('#sAfrC').value = S.afrCruise || 14.2; $('#sAfrW').value = S.afrWot || 12.8; $('#sAfrT').value = S.afrWotTps || 50; $('#sFitM').value = S.fitMax || 15; $('#sFitN').value = S.fitMinN || 3; $('#sGps').value = gps.src; });
    $('#sSave').addEventListener('click', () => {
      Object.assign(S, { afrCruise: +$('#sAfrC').value || 14.2, afrWot: +$('#sAfrW').value || 12.8, afrWotTps: +$('#sAfrT').value || 50, fitMax: Math.min(30, +$('#sFitM').value || 15), fitMinN: +$('#sFitN').value || 3, gpsSrc: $('#sGps').value });
      gps.src = S.gpsSrc; if (gps.src === 'gauge') gps.stopPhone(); C.saveS();
    });
  })();

  /* ================= live fan-out ================= */
  let raf = false;
  H.push((d) => {
    Object.assign(last, d); if (d.t == null) last.t = Date.now();
    if (d.gpsSrc === 'GAUGE' && d.GPS != null) dragFeed(d.t || Date.now(), d.GPS);
    graphPush(d); afrRecord(d);
    if (raf) return; raf = true;
    requestAnimationFrame(() => {
      raf = false;
      if (curTab === 'Grid') renderGrid();
      else if (curTab === 'Graph') { renderGraphCards(); drawGraph(); }
      else if (curTab === 'Tune') markLive();
      else if (curTab === 'AFR') { afrInfo(); if (afr.dirty && Date.now() - (afr.lastRender || 0) > 1000) { afr.lastRender = Date.now(); renderAfr(); } else afrLiveMark(); }
      else if (curTab === 'Drag') renderDrag();
    });
  });
  setInterval(() => { if (curTab === 'Drag') renderDrag(); }, 1000);
  PH.push((tab) => {
    curTab = tab; $('#tAdjPop').hidden = true;
    if (tab === 'Grid') renderGrid();
    if (tab === 'Graph') { renderGraphCards(); requestAnimationFrame(drawGraph); }
    if (tab === 'Tune') { fillMaps(); requestAnimationFrame(renderTune); }
    if (tab === 'AFR') renderAfr();
    if (tab === 'Drag') { if (gps.src !== 'gauge') gps.ensurePhone(); renderDrag(); }
    if (tab === 'Tools') subShow(curSub);
  });
  window.addEventListener('resize', () => { if (curTab === 'Graph') drawGraph(); if (curTab === 'Tune' && tune.view === '3d') draw3d(); });
  fillMaps(); afrAxesChanged();
})();
