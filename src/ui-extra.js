/* =====================================================================
 * Jet Smart Gauge — ui-extra.js
 * GRID · GRAPH · AFR LOG · DRAG LOG · GPS · TOOLS
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.JetCore, T = window.HT, P = window.HP;
  const { st, S, $, $$, toast, esc } = C;
  const H = (window.JetHooks = window.JetHooks || []);
  const PH = (window.JetPageHooks = window.JetPageHooks || []);
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
    { k: 'CRP', l: 'CRP volt', u: 'V', d: 2, col: '#ffc233', bar: [0, 5] }, { k: 'GEAR', l: 'GEAR', u: '', d: 0 },
  ];
  const OBDG = P.OBD.map(([k, en, th, u, d, f]) => ({ k, en, th, u, d, f }));
  GRID.forEach((g) => { g.f = 'b'; });
  const ALLG = GRID.concat(OBDG);  // (GRID array is reused as the 'visible' list)
  let gFuel = S.gridFuel || 'all';
  const gLabel = (g) => (window.JetI18N && JetI18N.lang() === 'th' && g.th) ? g.th : (g.en || g.l || g.k);
  const seen = new Set(), CELL = {};
  let gAvail = S.gridAvail !== false;
  function buildGrid() {
    const list = ALLG.filter((g) => (gFuel === 'all' || g.f === 'b' || g.f === (gFuel === 'gas' ? 'g' : 'd')) && (!gAvail || seen.has(g.k)));
    $('#ggrid').innerHTML = list.map((g) => `<div class="card gt"><div class="gh"><span>${gLabel(g)}</span><span>${g.u}</span></div><div class="gv" id="gv${g.k}" style="${g.col ? 'color:' + g.col : ''}">--</div>${g.bar ? `<div class="gbar" id="gb${g.k}">${'<i></i>'.repeat(18)}</div>` : ''}</div>`).join('');
    $$('#gFilter button[data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === gFuel));
    const ga = $('#gAvail'); if (ga) ga.classList.toggle('on', gAvail);
    GRID.length = 0; list.forEach((g) => GRID.push(g));
    for (const k in CELL) delete CELL[k];
    list.forEach((g) => { CELL[g.k] = { v: $('#gv' + g.k), b: g.bar ? $$('#gb' + g.k + ' i') : null, t: null, n: -1 }; });
    if (!list.length) $('#ggrid').innerHTML = '<div class="mut" style="padding:20px;grid-column:1/-1">ยังไม่มีค่าเข้ามา — เชื่อมต่อแล้วค่าจะโผล่ที่นี่เอง (กด “เฉพาะค่าที่มี” เพื่อดูทุกช่อง)</div>';
  }
  $('#gAvail').onclick = () => { gAvail = !gAvail; S.gridAvail = gAvail; C.saveS(); buildGrid(); renderGrid(); };
  $$('#gFilter button[data-f]').forEach((b) => b.onclick = () => { gFuel = b.dataset.f; S.gridFuel = gFuel; C.saveS(); buildGrid(); renderGrid(); $('.page.show').scrollTop = 0; });
  window.addEventListener('jetlang', () => { buildGrid(); renderGrid(); });
  function renderGrid() {
    let fresh = false;
    for (const k in last) if (last[k] != null && !seen.has(k) && typeof last[k] === 'number') { seen.add(k); fresh = true; }
    if (fresh && gAvail) { buildGrid(); }
    for (const g of GRID) {
      const c = CELL[g.k]; if (!c || !c.v) continue;
      const v = last[g.k];
      const t = v == null ? '--' : g.k === 'GEAR' ? (v === 0 ? 'N' : String(v)) : (+v).toFixed(g.d);
      if (t !== c.t) { c.t = t; c.v.textContent = t; }
      if (c.b) {
        const n = v == null ? 0 : Math.round(Math.max(0, Math.min(1, (v - g.bar[0]) / (g.bar[1] - g.bar[0]))) * 18);
        if (n !== c.n) { c.n = n; c.b.forEach((e, i) => { e.style.background = i >= n ? '' : g.grad ? (i < 9 ? '#2fd18b' : i < 13 ? '#d6e033' : i < 15 ? '#ffb020' : '#ff4d5e') : g.col; }); }
      }
    }
  }

  buildGrid();

  /* ================= GRAPH ================= */
  const GS = [
    { k: 'RPM', col: '#ff4d5e', lo: 0, hi: 12000, d: 0 }, { k: 'TPS', col: '#4d8dff', lo: 0, hi: 100, d: 1 },
    { k: 'SPD', l: 'GPS', col: '#2fd18b', lo: 0, hi: 200, d: 0 }, { k: 'AFR', src: S.gSrc === 'CRP' ? 'CRP' : 'AFR', col: '#ffc233', lo: 10, hi: 18, d: 1 },
  ];
  const gsApply = () => { const g = GS[3], c = g.src === 'CRP'; g.l = c ? 'CRP volt' : 'AFR'; g.lo = c ? 0 : 10; g.hi = c ? 5 : 18; g.d = c ? 2 : 1; };
  gsApply();
  const gbuf = []; let gpause = false; const gmm = {};
  $('#gcards').innerHTML = GS.map((g) => `<div class="card gc" style="--c:${g.col}"><div class="gh"><span id="gl${g.k}">${g.l || g.k}</span><span class="spark">⟋</span></div><div class="gv" id="gg${g.k}">--</div><div class="mm"><span class="lo" id="gn${g.k}">▼ --</span><span class="hi" id="gx${g.k}">▲ --</span></div></div>`).join('');
  $('#gcards').querySelectorAll('.gc')[3].style.cursor = 'pointer';
  $('#gcards').querySelectorAll('.gc')[3].onclick = () => { const g = GS[3]; g.src = g.src === 'CRP' ? 'AFR' : 'CRP'; S.gSrc = g.src; C.saveS(); gsApply(); delete gmm.AFR; renderGraphCards(); drawGraph(); };
  $('#gPause').onclick = () => { gpause = !gpause; $('#gPause').textContent = gpause ? '▶ เดินกราฟ' : '⏸ หยุดกราฟ'; };
  $('#gReset').onclick = () => { for (const k in gmm) delete gmm[k]; renderGraphCards(); };
  function graphPush(d) {
    const s = { t: d.t || Date.now(), RPM: d.RPM, TPS: d.TPS, SPD: d.GPS != null ? d.GPS : d.SPD, AFR: d.AFR, CRP: d.CRP };
    if (!gpause) { gbuf.push(s); while (gbuf.length && s.t - gbuf[0].t > 31000) gbuf.shift(); }
    for (const g of GS) { const v = s[g.src || g.k]; if (v == null) continue; const m = gmm[g.k] || (gmm[g.k] = { lo: v, hi: v, v }); m.v = v; m.lo = Math.min(m.lo, v); m.hi = Math.max(m.hi, v); }
    $('#glSPD').textContent = d.GPS != null ? 'GPS' : 'SPD';
  }
  function renderGraphCards() {
    $('#glAFR').textContent = GS[3].l;
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
        const v = p[s.src || s.k]; if (v == null) { on = false; continue; }
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
    const rpm = d.RPM / info.mul, ld = info.load === 'MAP' ? d.MAP : (d.TPS != null ? d.TPS : d.LOAD);
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

  const fmtAx = (v) => (Math.abs(v) >= 100 ? Math.round(v) : +(+v).toFixed(1));

  /* ================= AFR LOG ================= */
  // The axes follow the engine: rows = RPM from idle up to the redline (closer together at low rpm, where idle / cruise tuning happens),
  // columns = throttle 0–100 %. Redline and dial full-scale come from the chosen vehicle (Setup); without a redline 90 % of the dial is used.
  // v1.6.5: a 20 × 13 grid that fits the screen without scrolling; both axes are evenly spaced (RPM rounded to 50 / 100, TPS in twelfths of 0–100 %)
  const AFR_ROWS = 20, AFR_COLS = 13;
  const AFR_XS = Array.from({ length: AFR_COLS }, (_, i) => Math.round(i * 100 / (AFR_COLS - 1)));
  function engineAxes() {
    const top = Math.max(3000, Math.ceil((S.redline > 0 ? S.redline : (S.rpmMax || 12000) * 0.9) / 500) * 500);
    const lo = Math.max(600, Math.round(top * 0.07 / 100) * 100), step = top > 8000 ? 100 : 50, ys = [];
    for (let i = 0; i < AFR_ROWS; i++) { const v = Math.round((lo + (top - lo) * i / (AFR_ROWS - 1)) / step) * step; if (!ys.length || v > ys[ys.length - 1]) ys.push(v); }
    return { ys, xs: AFR_XS };
  }
  // the 26 × 23 grid of v1.5.4–v1.6.4 (RPM rows bunched at the low end, 23 TPS columns): rebuilt only to carry an old log over to the new grid
  const OLD_XS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 21, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100];
  function oldYs(lo, top) {
    const step = top > 8000 ? 100 : 50, ys = [];
    for (let i = 0; i < 26; i++) { const v = Math.round((lo + (top - lo) * Math.pow(i / 25, 1.35)) / step) * step; if (!ys.length || v > ys[ys.length - 1]) ys.push(v); }
    return ys;
  }
  function afrMigrate(ys, xs) {
    const o = LSget('jht.' + (isCrp() ? 'crp.' : 'afr.') + afr.mode + ':26x23:' + ys[0] + '-' + ys[ys.length - 1] + ':0-100', null);
    if (!o || !o.c) return null;
    const oy = oldYs(ys[0], ys[ys.length - 1]);
    if (o.rows !== oy.length || o.cols !== OLD_XS.length || o.c.length !== o.rows * o.cols) return null;
    const L = new T.AfrLog(ys.length, xs.length);
    o.c.forEach((s, k) => {
      if (!s || !(s.n > 0)) return;
      const r = Math.round(T.axisPos(ys, oy[Math.floor(k / o.cols)])), c = Math.round(T.axisPos(xs, OLD_XS[k % o.cols])), i = r * L.cols + c, d = L.c[i] || (L.c[i] = { n: 0, sum: 0, min: 99, max: 0 });
      d.n += s.n; d.sum += s.sum; d.min = Math.min(d.min, s.min); d.max = Math.max(d.max, s.max); L.total += s.n;
    });
    return L;
  }
  const AX0 = engineAxes();
  const afr = { xs: AX0.xs, ys: AX0.ys, title: 'ตามรอบเครื่อง', sig: '', log: null, dirty: false, rec: S.afrRec !== false, mode: S.logMode === 'crp' ? 'crp' : 'afr' };
  const isCrp = () => afr.mode === 'crp', LK = () => (isCrp() ? 'CRP' : 'AFR'), LD = () => (isCrp() ? 2 : 1);
  window.JetAfr = afr;
  const afrColor = (v) => { if (isCrp()) return `hsl(${Math.round(240 - 240 * Math.max(0, Math.min(1, v / 5)))},72%,46%)`;
     const stops = [[10.5, [210, 40, 60]], [11.5, [225, 70, 55]], [12.8, [215, 150, 40]], [14.0, [70, 190, 110]], [14.7, [40, 175, 120]], [15.6, [40, 130, 200]], [16.5, [70, 90, 220]], [18, [110, 70, 210]]];
    if (v <= stops[0][0]) return `rgb(${stops[0][1]})`; for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], k = (v - a) / (b - a); return `rgb(${ca.map((x, j) => Math.round(x + (cb[j] - x) * k))})`; } return `rgb(${stops[stops.length - 1][1]})`; };
  function afrAxesChanged(force) {
    const ax = engineAxes(), xs = ax.xs, ys = ax.ys, ttl = 'รอบเครื่อง ' + fmtRpm(ys[0]) + '–' + fmtRpm(ys[ys.length - 1]) + ' × TPS 0–100%', sig = afr.mode + ':' + ys.length + 'x' + xs.length + ':' + ys[0] + '-' + ys[ys.length - 1] + ':' + xs[0] + '-' + xs[xs.length - 1];
    afr.info = axisInfo(null, xs, ys);
    if (sig === afr.sig && afr.log) { afr.title = ttl; if (force && curTab === 'AFR') renderAfr(); return; }
    afrSave(); afr.xs = xs; afr.ys = ys; afr.sig = sig; afr.title = ttl;
    const o = LSget('jht.' + (isCrp() ? 'crp.' : 'afr.') + sig, null); afr.log = o ? T.AfrLog.from(o) : null;
    if (!afr.log) { afr.log = afrMigrate(ys, xs); if (afr.log) afr.dirty = true; else afr.log = new T.AfrLog(ys.length, xs.length); }
    if (curTab === 'AFR') renderAfr();
  }
  window.addEventListener('jetvehicle', () => afrAxesChanged(true));         // another vehicle / redline / dial range → axes follow (each axis set keeps its own log)
  function afrSave() { if (afr.log && afr.dirty) { LSset('jht.' + (afr.sig.indexOf('crp:') === 0 ? 'crp.' : 'afr.') + afr.sig, afr.log.toJSON()); afr.dirty = false; } }
  setInterval(afrSave, 5000);
  window.addEventListener('pagehide', afrSave);
  function afrRecord(d) {
    if (!afr.rec || d[LK()] == null || d.RPM == null || !afr.log) return;
    const p = livePos(afr.info, afr.xs, afr.ys, d);
    if (!p) return;
    if (isCrp()) afr.log.add(p.fr, p.fc, d.CRP, 0, 5.5); else afr.log.add(p.fr, p.fc, d.AFR, undefined, st.t && st.t.kind === 'obd' && st.t.fuel === 'd' ? 90 : undefined); afr.dirty = true;
  }
  function renderAfr() {
    if (!afr.log) afrAxesChanged();
    const L = afr.log, xs = afr.xs, ys = afr.ys;
    const I = afr.info;
    let h = `<thead><tr><th class="corner">${cornerLab(I).replace(' / ', '<br>')}</th>${xs.map((x) => `<th>${colLab(I, x)}</th>`).join('')}</tr></thead><tbody>`;
    for (let r = 0; r < ys.length; r++) {
      h += `<tr><th class="yh">${rowLab(I, ys[r])}</th>`;
      for (let c = 0; c < xs.length; c++) { const a = L.get(r, c); h += a ? `<td data-r="${r}" data-c="${c}" style="background:${afrColor(a.avg)};opacity:${Math.min(1, 0.45 + a.n / 10)}">${a.avg.toFixed(LD())}</td>` : `<td data-r="${r}" data-c="${c}" class="empty"></td>`; }
      h += '</tr>';
    }
    $('#atab').innerHTML = h + '</tbody>';
    fitAfr(); afrInfo(); afrLiveMark(true);
  }
  // the whole grid always fits the box (no scrolling): the table takes the box size, the text size follows the cell size
  function fitAfr() {
    const w = $('#atab').parentElement, t = $('#atab'), R = t.rows.length, C = R ? t.rows[0].cells.length : 0;
    if (!R || !w.clientWidth || !w.clientHeight) return;
    const W = w.clientWidth - 2, H = w.clientHeight - 2, rowH = H / R;
    const fs = Math.max(6, Math.min(13, rowH * 0.72, W / (C - 1 + 1.8) / 2.3));          // value "14.7" ≈ 2.3 em wide; row label column ≈ 1.8 cells
    const lab = Math.min(W * 0.2, fs * 4.3);                                              // row-label column ("11,000")
    t.classList.add('fit'); t.style.width = W + 'px'; t.style.height = H + 'px'; t.style.fontSize = fs + 'px';
    t.rows[0].cells[0].style.width = lab + 'px';
    t.dataset.fit = W + 'x' + H;
  }
  if (window.ResizeObserver) new ResizeObserver(() => { const t = $('#atab'), w = t.parentElement; if (curTab === 'AFR' && t.dataset.fit !== (w.clientWidth - 2) + 'x' + (w.clientHeight - 2)) fitAfr(); }).observe($('#atab').parentElement);
  window.addEventListener('resize', () => { if (curTab === 'AFR') fitAfr(); });
  function afrInfo() {
    const K = LK(), live = last[K] != null && Date.now() - (last.t || 0) < 3000;
    $('#aInfo').textContent = `${afr.ys.length}×${afr.xs.length} · แกนจาก "${afr.title}" · บันทึกแล้ว ${afr.log ? afr.log.filled() : 0} ช่อง · ${live ? K + ' สด ' + (+last[K]).toFixed(LD()) : 'ยังไม่มีข้อมูลสด (ต่อเกจ/เปิด DEMO)'}`;
    $('#aRec').classList.toggle('on', afr.rec); $('#aRec').textContent = afr.rec ? '● REC' : '○ REC';
  }
  const aWrap = $('#atab').parentElement, aCur = Cursor(aWrap, $('#atab'));
  ['pointerdown', 'wheel', 'touchstart'].forEach((ev) => aWrap.addEventListener(ev, () => { afr.userT = Date.now(); }, { passive: true }));
  function afrLiveMark() {
    const p = last.RPM != null && Date.now() - (last.t || 0) < 3000 ? livePos(afr.info, afr.xs, afr.ys) : null, I = afr.info;
    if (!p || curTab !== 'AFR') { if (!p) aCur.hide(); return; }
    aCur.show(p, `${fmtRpm(p.rpm)} rpm · ${I.load} ${(+p.ld).toFixed(1)}${I.unit}` + (last[LK()] != null ? ` → ${LK()} ${(+last[LK()]).toFixed(LD())}` : ''), afr.userT);
  }
  $('#atab').addEventListener('click', (e) => {
    const td = e.target.closest('td'); if (!td) return; const r = +td.dataset.r, c = +td.dataset.c, a = afr.log.get(r, c);
    const I = afr.info, where = `${rowLab(I, afr.ys[r])} · ${colLab(I, afr.xs[c])}`;
    toast(a ? `${where} → ${LK()} เฉลี่ย ${a.avg.toFixed(2)} (min ${a.min.toFixed(LD())} / max ${a.max.toFixed(LD())}) · ${a.n} ครั้ง` : `${where} — ยังไม่มีข้อมูล`, 4000);
  });
  function afrModeUi() {
    const c = isCrp();
    $('#aTitle').textContent = c ? 'CRP LOG · ดีเซล' : 'AFR LOG · เบนซิน';
    $('#aFuel').textContent = c ? '🛢 ดีเซล' : '⛽ เบนซิน';
    $('.ascale span').textContent = c ? '0 V ต่ำ · 2.5 V · 5 V สูง' : '11.5 หนา · 14.7 · 16.5 บาง';
    $('.abar').classList.toggle('crp', c);
    const nb = $('#nav button[data-p="' + C.pageOf('AFR') + '"]'); if (nb) nb.textContent = c ? 'CRP Log' : 'AFR Log';
  }
  $('#aFuel').onclick = () => { afrSave(); afr.mode = isCrp() ? 'afr' : 'crp'; S.logMode = afr.mode; C.saveS(); afrModeUi(); afrAxesChanged(); renderAfr(); };
  afrModeUi();
  $('#aRec').onclick = () => { afr.rec = !afr.rec; S.afrRec = afr.rec; C.saveS(); afrInfo(); };
  $('#aClr').onclick = async () => { if (await C.ask('ล้าง ' + (isCrp() ? 'CRP' : 'AFR') + ' Log ทั้งหมด?', true)) { afr.log.clear(); afr.dirty = true; afrSave(); renderAfr(); } };

  /* ================= DRAG LOG ================= */
  const dt = new T.DragTimer([201, 402, 500, 1000]);
  const drag2 = { runs: LSget('jht.drag', [null, null, null]), view: 0, last: null };
  $('#dSegs').innerHTML = Array.from({ length: 48 }, () => '<i></i>').join('') + '<div class="dticks">' + [0, 40, 80, 120, 160, 200, 240].map((v) => `<span>${v}</span>`).join('') + '</div>';
  function dragFeed(t, v) {
    if (v == null) return;
    drag2.last = { t, v };
    if (!drag2.armed) return;
    const res = dt.feed(t, v);
    if (dt.state === 'run' && drag2.runningSlot == null) { drag2.runningSlot = true; drag2.view = -1; }
    if (res) {
      const i = drag2.runs.findIndex((r) => !r); const slot = i >= 0 ? i : drag2.runs.reduce((m, r, k) => (r.at < drag2.runs[m].at ? k : m), 0);
      drag2.runs[slot] = res; drag2.view = slot; drag2.runningSlot = null; drag2.armed = false; LSset('jht.drag', drag2.runs);
      toast(`จบรอบ: ${res.splits[402] ? '402m ' + res.splits[402].toFixed(3) + ' s · ' : ''}MAX ${res.maxV} km/h → RUN ${slot + 1}`, 5000);
    }
    if (dt.state === 'done' && v < 1.5) { if (!drag2.rearm) drag2.rearm = t; else if (t - drag2.rearm > 2000) { dt.reset(); dt.feed(t, v); drag2.rearm = null; } } else drag2.rearm = null;
  }
  $('#dStart').onclick = () => {
    if (drag2.armed) { drag2.armed = false; dt.reset(); drag2.runningSlot = null; drag2.view = 0; toast('หยุด LOG แล้ว'); }
    else { if (gps.src !== 'gauge') gps.ensurePhone(); dt.reset(); drag2.armed = true; drag2.rearm = null; drag2.runningSlot = null; toast('พร้อมจับเวลา — ออกตัวได้เลย', 3000); }
    renderDrag();
  };
  $('#dReset').onclick = async () => { if (!(await C.ask('ล้างผลทั้ง 3 รอบ?', true))) return; drag2.runs = [null, null, null]; drag2.view = 0; drag2.armed = false; dt.reset(); LSset('jht.drag', drag2.runs); renderDrag(); };
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
    const sEl = $('#dState'); sEl.textContent = !g ? 'NO GPS' : running ? 'RUNNING' : dt.state === 'done' && !drag2.armed ? 'DONE' : drag2.armed ? 'READY' : 'STANDBY';
    $('#dStart').textContent = drag2.armed ? '■ STOP LOG' : '● START LOG';
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
    blk.innerHTML = `<h3 style="margin-top:16px">ค่า AFR และจีพีเอส</h3><div class="grid g3">
      <label class="f">เป้า AFR (ขับปกติ)<input id="sAfrC" type="number" step="0.1"></label>
      <label class="f">เป้า AFR (เปิดคันเร่งเต็ม)<input id="sAfrW" type="number" step="0.1"></label>
      <label class="f">ถือว่าเปิดเต็มเมื่อคันเร่ง ≥ (%)<input id="sAfrT" type="number"></label>
      <label class="f">แหล่งสัญญาณจีพีเอส<select id="sGps"><option value="auto">อัตโนมัติ (เกจก่อน)</option><option value="gauge">เกจเท่านั้น</option><option value="phone">มือถือเท่านั้น</option></select></label>
      <label class="f">การหมุนจอ<select id="sOrient"><option value="auto">อัตโนมัติ (ตามที่ถือมือถือ)</option><option value="land">แนวนอน</option><option value="port">แนวตั้ง</option></select></label></div>`;
    card.insertBefore(blk, anchor);
    $('#bSet').addEventListener('click', () => { $('#sAfrC').value = S.afrCruise || 14.2; $('#sAfrW').value = S.afrWot || 12.8; $('#sAfrT').value = S.afrWotTps || 50; $('#sGps').value = gps.src; $('#sOrient').value = S.orient || 'auto'; });
    // screen rotation (Android app): auto follows how the phone is held, or pin it to landscape / portrait
    const applyOrient = () => { try { if (window.JetNative && window.JetNative.setOrientation) window.JetNative.setOrientation(S.orient || 'auto'); } catch (e) { /* older shell: the manifest default applies */ } };
    $('#sOrient').onchange = () => { S.orient = $('#sOrient').value; C.saveS(); applyOrient(); };
    applyOrient();
    $('#sSave').addEventListener('click', () => {
      Object.assign(S, { afrCruise: +$('#sAfrC').value || 14.2, afrWot: +$('#sAfrW').value || 12.8, afrWotTps: +$('#sAfrT').value || 50, gpsSrc: $('#sGps').value });
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
      else if (curTab === 'AFR') { afrInfo(); if (afr.dirty && Date.now() - (afr.lastRender || 0) > 1000) { afr.lastRender = Date.now(); renderAfr(); } else afrLiveMark(); }
      else if (curTab === 'Drag') renderDrag();
    });
  });
  setInterval(() => { if (curTab === 'Drag') renderDrag(); if (curTab === 'AFR') afrInfo(); }, 1000);
  PH.push((tab) => {
    curTab = tab;
    if (tab === 'Grid') renderGrid();
    if (tab === 'Graph') { renderGraphCards(); requestAnimationFrame(drawGraph); }
    if (tab === 'AFR') renderAfr();
    if (tab === 'Drag') { if (gps.src !== 'gauge') gps.ensurePhone(); renderDrag(); }
    if (tab === 'Tools') subShow(curSub);
  });
  window.addEventListener('resize', () => { if (curTab === 'Graph') drawGraph(); });
  afrAxesChanged();
})();
