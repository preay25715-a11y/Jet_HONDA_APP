/* =====================================================================
 * Jet Smart Gauge — tune.js
 * Map-table engine: TunerPro XDF parsing, table read/write on a .bin,
 * AFR log aggregation and AFR-based fuel correction (FIT), drag-run timing.
 * Pure logic — no DOM — so it runs in the browser and in node tests.
 * ===================================================================== */
(function (root) {
  'use strict';
  const T = {};

  /* ---------- tiny XML parser (enough for TunerPro XDF) ---------- */
  T.parseXML = (src) => {
    const rootN = { tag: '#root', attrs: {}, children: [], text: '' };
    const stack = [rootN];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>|([^<]+)/g;
    const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[1] != null) { top.text += m[1]; continue; }
      if (m[3]) {
        if (m[2] === '/') { if (stack.length > 1) stack.pop(); continue; }
        const attrs = {}; const ar = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a;
        while ((a = ar.exec(m[4]))) attrs[a[1].toLowerCase()] = ent(a[3] != null ? a[3] : a[4]);
        const n = { tag: m[3].toUpperCase(), attrs, children: [], text: '' };
        top.children.push(n);
        if (!m[5]) stack.push(n);
      } else if (m[6] != null) top.text += ent(m[6]);
    }
    return rootN;
  };
  const kids = (n, tag) => n.children.filter((c) => c.tag === tag);
  const kid = (n, tag) => n.children.find((c) => c.tag === tag);
  const num = (s, d) => { if (s == null || s === '') return d; s = String(s).trim(); const v = /^0x/i.test(s) ? parseInt(s, 16) : parseFloat(s); return isNaN(v) ? d : v; };

  /* ---------- safe equation → function ---------- */
  T.makeEq = (eq) => {
    eq = (eq || 'X').trim();
    if (!/^[\sXx0-9.+\-*/()^eE]*$/.test(eq)) eq = 'X';
    const js = eq.replace(/x/g, 'X').replace(/\^/g, '**');
    try { const f = new Function('X', '"use strict";return (' + js + ');'); f(1); return f; } catch (e) { return (X) => X; }
  };

  /* ---------- raw cell access ---------- */
  // d = {addr, bits(8|16|32), signed, lsb (little endian)}
  T.rawGet = (u8, d, addr) => {
    const n = d.bits / 8; let v = 0;
    if (addr < 0 || addr + n > u8.length) return NaN;
    for (let i = 0; i < n; i++) v = v * 256 + u8[addr + (d.lsb ? n - 1 - i : i)];
    if (d.signed && v >= 2 ** (d.bits - 1)) v -= 2 ** d.bits;
    return v;
  };
  T.rawSet = (u8, d, addr, v) => {
    const n = d.bits / 8, max = d.signed ? 2 ** (d.bits - 1) - 1 : 2 ** d.bits - 1, min = d.signed ? -(2 ** (d.bits - 1)) : 0;
    v = Math.max(min, Math.min(max, Math.round(v)));
    if (v < 0) v += 2 ** d.bits;
    for (let i = n - 1; i >= 0; i--) { u8[addr + (d.lsb ? n - 1 - i : i)] = v & 0xFF; v = Math.floor(v / 256); }
  };
  // inverse of a monotonic equation by bisection over the raw range
  T.toRaw = (d, value) => {
    const f = d.eq, lo0 = d.signed ? -(2 ** (d.bits - 1)) : 0, hi0 = d.signed ? 2 ** (d.bits - 1) - 1 : 2 ** d.bits - 1;
    const inc = f(hi0) >= f(lo0);
    let lo = lo0, hi = hi0;
    for (let i = 0; i < 40 && hi - lo > 1; i++) {
      const mid = Math.floor((lo + hi) / 2), fm = f(mid);
      if ((fm < value) === inc) lo = mid; else hi = mid;
    }
    return Math.abs(f(lo) - value) <= Math.abs(f(hi) - value) ? lo : hi;
  };

  /* ---------- XDF → table definitions ---------- */
  function axisDef(ax, base) {
    if (!ax) return null;
    const ed = kid(ax, 'EMBEDDEDDATA'), m = kid(ax, 'MATH');
    const count = num((kid(ax, 'INDEXCOUNT') || {}).text, 0);
    const d = { count, eq: T.makeEq(m && m.attrs.equation), eqText: (m && m.attrs.equation) || 'X', labels: null };
    if (ed && ed.attrs.mmedaddress) {
      const tf = num(ed.attrs.mmedtypeflags, 0);
      Object.assign(d, { addr: num(ed.attrs.mmedaddress, 0) - base, bits: num(ed.attrs.mmedelementsizebits, 8), signed: !!(tf & 1), lsb: !!(tf & 2), stride: num(ed.attrs.mmedmajorstridebits, 0) });
      if (!d.count) d.count = num(ed.attrs.mmedcolcount, 0) || num(ed.attrs.mmedrowcount, 0);
    } else {
      const labs = kids(ax, 'LABEL').sort((a, b) => num(a.attrs.index, 0) - num(b.attrs.index, 0)).map((l) => num(l.attrs.value, NaN));
      d.labels = labs.length ? labs : null;
      if (!d.count && labs.length) d.count = labs.length;
    }
    return d;
  }
  T.parseXDF = (text) => {
    const doc = T.parseXML(text);
    const fmt = doc.children.find((c) => c.tag === 'XDFFORMAT') || doc;
    const hdr = kid(fmt, 'XDFHEADER');
    let base = 0;
    if (hdr) { const bo = kid(hdr, 'BASEOFFSET'); if (bo) { base = num(bo.attrs.offset, 0); if (num(bo.attrs.subtract, 0) === 0) base = -base; } }
    // TunerPro: subtract="0" means ADD offset to addresses, subtract="1" means subtract
    const tables = [];
    for (const t of kids(fmt, 'XDFTABLE')) {
      const title = ((kid(t, 'TITLE') || {}).text || 'Table').trim();
      const axes = {}; for (const a of kids(t, 'XDFAXIS')) axes[(a.attrs.id || '').toLowerCase()] = a;
      const zx = axes.z; if (!zx) continue;
      const ed = kid(zx, 'EMBEDDEDDATA'); if (!ed || !ed.attrs.mmedaddress) continue;
      const tf = num(ed.attrs.mmedtypeflags, 0), m = kid(zx, 'MATH');
      const z = { addr: num(ed.attrs.mmedaddress, 0) - base, bits: num(ed.attrs.mmedelementsizebits, 8), signed: !!(tf & 1), lsb: !!(tf & 2), colMajor: !!(tf & 4),
        rows: num(ed.attrs.mmedrowcount, 1) || 1, cols: num(ed.attrs.mmedcolcount, 1) || 1, eq: T.makeEq(m && m.attrs.equation), eqText: (m && m.attrs.equation) || 'X',
        dec: num((kid(zx, 'DECIMALPL') || {}).text, 2), stride: num(ed.attrs.mmedmajorstridebits, 0) };
      tables.push({ title, z, x: axisDef(axes.x, base), y: axisDef(axes.y, base) });
    }
    for (const c of kids(fmt, 'XDFCONSTANT')) {
      const ed = kid(c, 'EMBEDDEDDATA'); if (!ed || !ed.attrs.mmedaddress) continue;
      const tf = num(ed.attrs.mmedtypeflags, 0), m = kid(c, 'MATH');
      tables.push({ title: ((kid(c, 'TITLE') || {}).text || 'Constant').trim() + ' (ค่าเดี่ยว)', z: { addr: num(ed.attrs.mmedaddress, 0) - base, bits: num(ed.attrs.mmedelementsizebits, 8), signed: !!(tf & 1), lsb: !!(tf & 2), rows: 1, cols: 1, eq: T.makeEq(m && m.attrs.equation), eqText: (m && m.attrs.equation) || 'X', dec: num((kid(c, 'DECIMALPL') || {}).text, 2) }, x: null, y: null });
    }
    return tables;
  };

  /* ---------- table model ---------- */
  T.cellAddr = (z, r, c) => {
    const n = z.bits / 8;
    const major = z.stride ? z.stride / 8 : (z.colMajor ? z.rows : z.cols) * n;
    return z.colMajor ? z.addr + c * major + r * n : z.addr + r * major + c * n;
  };
  T.readAxis = (u8, a, n) => {
    if (!a) return Array.from({ length: n }, (_, i) => i);
    if (a.labels) return Array.from({ length: n }, (_, i) => (a.labels[i] != null ? a.labels[i] : i));
    if (a.addr == null) return Array.from({ length: n }, (_, i) => i);
    const sz = a.stride ? a.stride / 8 : a.bits / 8;
    return Array.from({ length: n }, (_, i) => +a.eq(T.rawGet(u8, a, a.addr + i * sz)).toFixed(3));
  };
  T.readTable = (u8, t) => {
    const z = t.z, vals = [];
    for (let r = 0; r < z.rows; r++) { const row = []; for (let c = 0; c < z.cols; c++) row.push(z.eq(T.rawGet(u8, z, T.cellAddr(z, r, c)))); vals.push(row); }
    return { vals, xs: T.readAxis(u8, t.x, z.cols), ys: T.readAxis(u8, t.y, z.rows) };
  };
  T.writeCell = (u8, t, r, c, value) => {
    const z = t.z; T.rawSet(u8, z, T.cellAddr(z, r, c), T.toRaw(z, value));
    return z.eq(T.rawGet(u8, z, T.cellAddr(z, r, c)));   // value actually stored (quantised)
  };
  T.isFuel = (t) => /fuel|inj|น้ำมัน|หัวฉีด|ฉีด/i.test(t.title);

  // nearest index (with fraction) of value v in axis array (ascending or descending)
  T.axisPos = (axis, v) => {
    if (!axis.length || v == null || isNaN(v)) return null;
    const asc = axis[axis.length - 1] >= axis[0];
    const a = asc ? axis : axis.slice().reverse();
    let i;
    if (v <= a[0]) i = 0; else if (v >= a[a.length - 1]) i = a.length - 1;
    else { let k = 0; while (k < a.length - 1 && a[k + 1] < v) k++; i = k + (v - a[k]) / ((a[k + 1] - a[k]) || 1); }
    return asc ? i : a.length - 1 - i;
  };

  /* ---------- AFR log (per RPM×TPS cell) ---------- */
  T.AfrLog = class {
    constructor(rows, cols) { this.rows = rows; this.cols = cols; this.clear(); }
    clear() { this.c = Array.from({ length: this.rows * this.cols }, () => null); this.total = 0; }
    add(r, c, afr, lo, hi) {   // AFR: 6..25 (default) — CRP volt log passes 0..5.5
      if (r == null || c == null || !(afr >= (lo == null ? 6.0001 : lo) && afr <= (hi == null ? 24.9999 : hi))) return;
      r = Math.round(r); c = Math.round(c);
      const k = r * this.cols + c; const s = this.c[k] || (this.c[k] = { n: 0, sum: 0, min: 99, max: 0 });
      s.n++; s.sum += afr; s.min = Math.min(s.min, afr); s.max = Math.max(s.max, afr); this.total++;
    }
    get(r, c) { const s = this.c[r * this.cols + c]; return s ? { n: s.n, avg: s.sum / s.n, min: s.min, max: s.max } : null; }
    filled() { return this.c.filter(Boolean).length; }
    toJSON() { return { rows: this.rows, cols: this.cols, c: this.c, total: this.total }; }
    static from(o) { const l = new T.AfrLog(o.rows, o.cols); if (o.c && o.c.length === l.c.length) { l.c = o.c; l.total = o.total || 0; } return l; }
  };

  // AFR target by throttle (rich at WOT, leaner at cruise)
  T.afrTarget = (tps, cfg) => (tps >= (cfg.wotTps || 50) ? cfg.wot || 12.8 : cfg.cruise || 14.2);
  // fuel correction: more fuel when measured AFR is leaner than target
  T.fitFactor = (measured, target, maxPct) => {
    const f = measured / target, m = (maxPct || 15) / 100;
    return Math.max(1 - m, Math.min(1 + m, f));
  };

  /* ---------- drag timing ---------- */
  // feed samples {t ms, v km/h}; distances by trapezoid speed integration
  T.DragTimer = class {
    constructor(marks) { this.marks = marks || [201, 402, 500, 1000]; this.reset(); }
    reset() { this.state = 'ready'; this.prev = null; this.dist = 0; this.t0 = 0; this.splits = {}; this.maxV = 0; this.speeds = {}; this.elapsed = 0; this.lowSince = null; }
    feed(t, v) {
      const p = this.prev; this.prev = { t, v };
      if (this.state === 'ready') {
        if (p && p.v < 1.5 && v >= 1.5) { // launch: interpolate the crossing of 1.5 km/h
          const k = (1.5 - p.v) / ((v - p.v) || 1); this.t0 = p.t + k * (t - p.t); this.state = 'run';
          this.dist = ((v + 1.5) / 2 / 3.6) * ((t - this.t0) / 1000);
        }
        return null;
      }
      if (this.state !== 'run' || !p) return null;
      const d0 = this.dist; this.dist += ((p.v + v) / 2 / 3.6) * ((t - p.t) / 1000);
      this.maxV = Math.max(this.maxV, v); this.elapsed = (t - this.t0) / 1000;
      for (const m of this.marks) if (this.splits[m] == null && this.dist >= m) {
        const k = (m - d0) / ((this.dist - d0) || 1);
        this.splits[m] = +(((p.t + k * (t - p.t)) - this.t0) / 1000).toFixed(4); this.speeds[m] = Math.round(p.v + k * (v - p.v));
      }
      for (const s of [60, 100]) if (this.speeds['v' + s] == null && v >= s && p.v < s) {
        const k = (s - p.v) / ((v - p.v) || 1); this.speeds['v' + s] = +(((p.t + k * (t - p.t)) - this.t0) / 1000).toFixed(3);
      }
      const last = this.marks[this.marks.length - 1];
      if (this.dist >= last) { this.state = 'done'; return this.result(); }
      if (v < 1.5) { this.lowSince = this.lowSince || t; if (t - this.lowSince > 1500) { this.state = 'done'; return this.result(); } } else this.lowSince = null;
      return null;
    }
    result() { return { splits: { ...this.splits }, speeds: { ...this.speeds }, maxV: Math.round(this.maxV), dist: Math.round(this.dist), time: +this.elapsed.toFixed(4), at: Date.now() }; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = T;
  else root.HT = T;
})(typeof window !== 'undefined' ? window : globalThis);
