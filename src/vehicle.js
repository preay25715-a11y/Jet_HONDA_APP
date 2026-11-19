/* =====================================================================
 * Jet Smart Gauge — vehicle.js
 * Honda motorcycles sold in Thailand: pick the model in Setup → sets gauge scale,
 * gear count (CVT hides the gear box), plus gear learning and derived values.
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.JetCore, P = window.HP;
  const { st, S, $, $$, toast } = C;

  // [id, group, name, cc, gears (0 = CVT/auto), gauge rpm scale]  — defaults, all editable in Setup
  const B = (g, rows) => rows.map((r) => ({ id: g[0] + '-' + r[0].toLowerCase().replace(/[^a-z0-9]+/g, ''), group: g[1], name: r[0], cc: r[1], gears: r[2], rpm: r[3] }));
  const BIKES = [].concat(
    B(['fam', 'รถครอบครัว / Cub'], [
      ['Wave 100', 97, 4, 10000], ['Wave 110i', 109, 4, 10000], ['Wave 110 (คาร์บู)', 109, 4, 10000], ['Wave 125i', 125, 4, 10000], ['Wave 125 / 125R / 125S', 125, 4, 10000],
      ['Dream 110i / Dream Super Cub', 109, 4, 10000], ['Dream 125', 125, 4, 10000], ['Super Cub 110', 109, 4, 10000], ['Super Cub C125 / C125', 125, 4, 10000],
    ]),
    B(['sct', 'สกู๊ตเตอร์ (CVT)'], [
      ['Scoopy-i (110)', 109, 0, 10000], ['Zoomer-X', 109, 0, 10000], ['Moove', 109, 0, 10000], ['Spacy-i', 109, 0, 10000], ['Icon', 109, 0, 10000],
      ['Click 110i', 109, 0, 10000], ['Click 125i', 125, 0, 10000], ['Click 150i', 149, 0, 10000], ['Click 160 / 160 Sport', 157, 0, 10000],
      ['Giorno+', 125, 0, 10000], ['Lead 125', 125, 0, 10000], ['PCX 125', 125, 0, 10000], ['PCX 150', 149, 0, 10000], ['PCX 160 / PCX e:HEV', 157, 0, 10000],
      ['ADV 150', 149, 0, 10000], ['ADV 160', 157, 0, 10000], ['ADV 350', 330, 0, 9000], ['Forza 300', 279, 0, 9000], ['Forza 350', 330, 0, 9000], ['SH 125 / SH 150', 125, 0, 10000], ['SH 350', 330, 0, 9000],
    ]),
    B(['car', 'รถยนต์ Honda (ELM327)'], [
      ['City 1.5', 1497, 0, 8000], ['City Turbo 1.0', 998, 0, 7000], ['City e:HEV', 1498, 0, 7000], ['Civic 1.8', 1799, 0, 8000], ['Civic Turbo 1.5', 1498, 0, 7000],
      ['Jazz', 1497, 0, 8000], ['Brio', 1199, 0, 8000], ['Mobilio', 1497, 0, 8000], ['BR-V', 1497, 0, 8000], ['HR-V', 1799, 0, 8000], ['CR-V 2.4', 2356, 0, 8000], ['Accord 2.0', 1998, 0, 8000],
    ]),
    B(['mini', 'มินิไบค์ / Retro'], [
      ['Monkey 125', 125, 5, 10000], ['MSX125 / Grom', 125, 4, 10000], ['Dax 125', 125, 4, 10000], ['CT125 / Hunter Cub', 125, 4, 10000],
    ]),
    B(['spt', 'สปอร์ต / เนคเก็ต'], [
      ['CBR150R', 149, 6, 13000], ['CB150R ExMotion', 149, 6, 13000], ['CB150X', 149, 6, 12000], ['Sonic 150R', 149, 6, 13000], ['CBR250R', 249, 6, 12000], ['CBR250RR', 249, 6, 14000],
      ['CB300R', 286, 6, 12000], ['CBR300R', 286, 6, 12000], ['CBR500R / E-Clutch', 471, 6, 10000], ['CB500F / CB500 Hornet', 471, 6, 10000],
      ['CB650F / CB650R', 649, 6, 12000], ['CBR650F / CBR650R', 649, 6, 12000], ['CB750 Hornet', 755, 6, 11000], ['CB1000 Hornet', 999, 6, 12000], ['CB1000GT', 999, 6, 12000], ['CB1000R', 998, 6, 12000],
      ['CBR1000RR / Fireblade', 999, 6, 14000], ['CBR1000RR-R Fireblade SP', 999, 6, 15000],
    ]),
    B(['crz', 'ครุยเซอร์ / คลาสสิก'], [
      ['Rebel 300', 286, 6, 10000], ['Rebel 500', 471, 6, 9000], ['CL500', 471, 6, 10000], ['Rebel 1100 / DCT', 1084, 6, 8000], ['GB350 / GB350C', 348, 5, 7000],
    ]),
    B(['adv', 'ผจญภัย / ออฟโรด'], [
      ['CRF150L', 149, 5, 10000], ['CRF250L / Rally', 249, 6, 11000], ['CRF300L / Rally', 286, 6, 10000], ['NX500', 471, 6, 10000],
      ['XL750 Transalp', 755, 6, 10000], ['CRF1100L Africa Twin', 1084, 6, 9000], ['X-ADV', 745, 6, 8000], ['NC750X', 745, 6, 8000],
    ]),
    B(['tour', 'ทัวร์ริ่ง'], [['NT1100', 1084, 6, 8000], ['Gold Wing', 1833, 7, 7000]]),
    [{ id: 'custom', group: 'อื่นๆ', name: 'กำหนดเอง (รุ่นอื่น)', cc: 0, gears: 6, rpm: 12000 }]
  );
  /* Data from the Smart Gauge HONDA project (JetOBD2HONDA): [name regex, tank L, redline rpm, cylinders, injector flow cc/min (all injectors), gearbox set] */
  const GSET = { // km/h per 1000 rpm in each gear (approximate)
    W4: [4.4, 7.2, 9.8, 12.4], C4: [4.0, 6.6, 9.2, 11.8], G5: [5.2, 8.0, 10.4, 12.4, 14.2], S6: [5.0, 7.4, 9.6, 11.6, 13.2, 14.6],
    M6: [6.0, 8.8, 11.2, 13.4, 15.2, 16.8], B6: [8.0, 11.2, 14.0, 16.4, 18.4, 20.0], GB: [8.0, 12.5, 16.0, 19.0, 22.0],
    L6: [9.0, 13.0, 16.6, 19.8, 22.6, 25.4], R6: [9.5, 12.5, 15.0, 17.5, 19.5, 21.0] };
  const CARTANK = { 'City 1.5': 40, 'City Turbo 1.0': 40, 'City e:HEV': 40, 'Civic 1.8': 47, 'Civic Turbo 1.5': 47, Jazz: 40, Brio: 35, Mobilio: 42, 'BR-V': 42, 'HR-V': 50, 'CR-V 2.4': 58, 'Accord 2.0': 56 };
  const JD = [
    [/^Click 125/, 5.5, 9500, 1, 105], [/^Click 160/, 5.5, 10000, 1, 130], [/^PCX 160/, 8.1, 10000, 1, 130], [/^ADV 160/, 8.1, 10000, 1, 130],
    [/^Scoopy/, 4.2, 9500, 1, 90], [/^Giorno/, 5.4, 9500, 1, 105], [/^Lead 125/, 6.0, 9500, 1, 105], [/^Zoomer/, 4.5, 9500, 1, 90],
    [/^ADV 350/, 11.7, 9000, 1, 240], [/^Forza 350/, 11.7, 9000, 1, 240],
    [/^Wave 110i/, 4.0, 9000, 1, 90, 'W4'], [/^Wave 125i/, 5.4, 9000, 1, 100, 'W4'], [/^Super Cub 110/, 3.7, 9000, 1, 90, 'C4'],
    [/^Dream 110i/, 4.0, 9000, 1, 90, 'C4'], [/^Super Cub C125/, 3.7, 9000, 1, 100, 'C4'], [/^CT125/, 5.3, 9000, 1, 100, 'C4'],
    [/^Monkey/, 5.6, 9000, 1, 100, 'G5'], [/^Dax/, 3.8, 9000, 1, 100, 'C4'], [/^MSX125/, 6.0, 9500, 1, 100, 'G5'],
    [/^CBR150R/, 12.0, 12000, 1, 135, 'S6'], [/^CB150R/, 8.5, 11500, 1, 135, 'S6'], [/^CBR250RR/, 14.5, 14000, 2, 150, 'M6'],
    [/^CB300R/, 10.0, 11000, 1, 200, 'M6'], [/^CBR300R/, 13.0, 11000, 1, 200, 'M6'], [/^Rebel 300/, 11.2, 10500, 1, 200, 'M6'],
    [/^CRF250L/, 7.8, 10500, 1, 180, 'M6'], [/^CRF300L/, 7.8, 10500, 1, 200, 'M6'],
    [/^GB350/, 15.0, 6500, 1, 190, 'GB'], [/^CB500 Hornet|^CB500F/, 17.7, 9500, 2, 190, 'B6'], [/^CBR500R/, 17.1, 9500, 2, 190, 'B6'],
    [/^NX500/, 17.5, 9500, 2, 190, 'B6'], [/^Rebel 500/, 11.2, 9500, 2, 190, 'B6'], [/^CL500/, 12.0, 9500, 2, 190, 'B6'],
    [/^CB650/, 15.4, 12500, 4, 170, 'B6'], [/^CBR650/, 15.4, 12500, 4, 170, 'B6'],
    [/^NC750X/, 14.1, 7000, 2, 280, 'L6'], [/^X-ADV/, 13.2, 7000, 2, 280, 'L6'], [/^XL750|^CB750 Hornet/, 16.9, 9500, 2, 300, 'B6'],
    [/^CRF1100L/, 18.8, 8500, 2, 330, 'L6'], [/^NT1100/, 20.4, 8500, 2, 330, 'L6'], [/^Rebel 1100/, 13.6, 7500, 2, 330, 'L6'],
    [/^CB1000 Hornet/, 17.0, 11500, 4, 250, 'B6'], [/^CB1000GT/, 21.0, 11500, 4, 250, 'B6'], [/^CBR1000RR-R/, 16.1, 14500, 4, 300, 'R6'],
    [/^City 1\.5|^Civic 1\.8|^Jazz|^BR-V/, 0, 6800, 4, 0], [/^City Turbo/, 0, 6200, 3, 0], [/^City e:HEV/, 0, 6200, 4, 0], [/^Civic Turbo/, 0, 6200, 4, 0], [/^Brio|^Mobilio/, 0, 6600, 4, 0],
    [/^HR-V/, 0, 6600, 4, 0], [/^CR-V/, 0, 6600, 4, 0], [/^Accord/, 0, 6600, 4, 0],
  ];
  BIKES.forEach((b) => {
    const j = JD.find((r) => r[0].test(b.name)); if (!j) return;
    b.tank = j[1]; b.red = j[2]; b.cyl = j[3]; b.inj = j[4];
    if (!b.tank && CARTANK[b.name]) b.tank = CARTANK[b.name];
    if (j[5] && GSET[j[5]]) b.gset = GSET[j[5]];
    b.rpm = Math.ceil((j[2] + 500) / 1000) * 1000;       // gauge scale = redline + a little
  });
  P.BIKES = BIKES;
  const byId = (id) => BIKES.find((b) => b.id === id);

  // starting ratio guess (rpm per km/h) — refined by "learn gear"; rough shape only
  const DEFAULT_RATIOS = { 4: '150 95 70 56', 5: '150 95 70 56 47', 6: '140 92 68 54 45 38', 7: '140 92 68 54 45 38 33' };

  function apply(b, keepCustom) {
    S.bike = b.id;
    S.rpmMax = b.rpm; S.cvt = b.gears === 0; S.gears = b.gears;
    if (!keepCustom || !S.gearRatios) S.gearRatios = b.gears ? (b.gset && b.gset.length === b.gears ? b.gset.map((k) => Math.round(1000 / k * 10) / 10).join(' ') : (DEFAULT_RATIOS[b.gears] || DEFAULT_RATIOS[6])) : '';
    S.tankL = b.tank || 0; S.injFlow = b.inj || 0; S.redline = b.red || 0; S.cyl = b.cyl || 1;
    S.gearLearned = false;
    C.saveS(); refresh();
  }
  function refresh() {
    const gb = $('.gearbox'); if (gb) gb.style.display = S.cvt ? 'none' : '';
    const wide = $('.botrow .wide'); if (wide) wide.style.gridColumn = S.cvt ? '1 / -1' : '';
    const b = byId(S.bike), t = $('#bikeName'); if (t) t.textContent = b ? b.name : '—';
  }

  /* ---------- Setup block ---------- */
  (function ui() {
    const card = $('#mSet .card'), anchor = card.querySelector('h3:nth-of-type(2)');
    const blk = document.createElement('div');
    const groups = [...new Set(BIKES.map((b) => b.group))];
    blk.innerHTML = `<h3 style="margin-top:16px">🏍 รุ่นรถ</h3><div class="gsect">
      <label class="f">เลือกรุ่น Honda<select id="sBike"><option value="">— เลือกรุ่น —</option>${groups.map((g) => `<optgroup label="${g}">${BIKES.filter((b) => b.group === g).map((b) => `<option value="${b.id}">${b.name}${b.cc ? ' · ' + b.cc + ' cc' : ''}${b.gears ? ' · ' + b.gears + ' สปีด' : ' · CVT'}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <div class="grid g3">
        <label class="f">จำนวนเกียร์ (0 = ออโต้/CVT)<input id="sGears" type="number" min="0" max="8"></label>
        <label class="f">RPM เต็มสเกลหน้าปัด<input id="sRpmMax" type="number" step="500"></label>
        <label class="f">อัตราส่วนเกียร์ (rpm ต่อ km/h)<input id="sRatios" placeholder="140 92 68 54 45 38" autocapitalize="none"></label>
        <label class="f">ความจุถังน้ำมัน (ลิตร)<input id="sTank" type="number" step="0.1" min="0"></label>
        <label class="f">หัวฉีด รวม (cc/นาที)<input id="sInj" type="number" step="5" min="0"></label>
        <label class="f">รอบเรดไลน์ (rpm)<input id="sRed" type="number" step="100" min="0"></label>
      </div>
      <div class="row" id="gearLearn" style="margin-top:8px;align-items:center"><span class="mut">เรียนรู้เกียร์:</span>
        <select id="sLg"></select><button class="btn" id="sLgGo">บันทึกเกียร์นี้ (ขับค้างเกียร์ไว้ 2 วิ)</button></div>
      <div class="mut" id="sLgMsg" style="margin-top:6px;font-size:13px"></div>
    </div>`;
    card.insertBefore(blk, anchor);
    const fill = () => {
      $('#sBike').value = S.bike || ''; $('#sGears').value = S.gears != null ? S.gears : 6; $('#sRpmMax').value = S.rpmMax || 12000; $('#sRatios').value = S.gearRatios || ''; $('#sTank').value = S.tankL || ''; $('#sInj').value = S.injFlow || ''; $('#sRed').value = S.redline || '';
      const n = +$('#sGears').value; $('#sLg').innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">เกียร์ ${i + 1}</option>`).join('');
      $('#gearLearn').style.display = n ? '' : 'none';
    };
    $('#bSet').addEventListener('click', fill);
    $('#sBike').onchange = () => { const b = byId($('#sBike').value); if (b) { apply(b, false); fill(); toast('ตั้งค่ารุ่น ' + b.name + ' แล้ว'); } };
    $('#sGears').onchange = () => { S.gears = Math.max(0, Math.min(8, +$('#sGears').value || 0)); S.cvt = S.gears === 0; if (S.gears && !S.gearRatios) S.gearRatios = DEFAULT_RATIOS[S.gears] || DEFAULT_RATIOS[6]; C.saveS(); refresh(); fill(); };
    $('#sRpmMax').onchange = () => { S.rpmMax = Math.max(3000, +$('#sRpmMax').value || 12000); C.saveS(); };
    $('#sRatios').onchange = () => { S.gearRatios = $('#sRatios').value.trim(); S.gearLearned = true; C.saveS(); };
    $('#sTank').onchange = () => { S.tankL = Math.max(0, +$('#sTank').value || 0); C.saveS(); };
    $('#sInj').onchange = () => { S.injFlow = Math.max(0, +$('#sInj').value || 0); C.saveS(); };
    $('#sRed').onchange = () => { S.redline = Math.max(0, +$('#sRed').value || 0); C.saveS(); };
    // learn: average rpm/speed while a gear is held
    $('#sLgGo').onclick = async () => {
      const g = +$('#sLg').value, msg = $('#sLgMsg'); if (!st.last || st.last.RPM == null) { msg.textContent = 'ยังไม่มีค่ารอบเครื่อง — เชื่อมต่อก่อน'; return; }
      const acc = []; msg.textContent = 'กำลังเก็บค่า… ค้างเกียร์ ' + g + ' และคงความเร็วไว้';
      const t0 = Date.now();
      while (Date.now() - t0 < 2000) { const d = st.last, sp = d.SPD != null ? d.SPD : d.GPS; if (d.RPM > 1200 && sp > 8) acc.push(d.RPM / sp); await new Promise((r) => setTimeout(r, 50)); }
      if (acc.length < 10) { msg.textContent = 'เก็บค่าไม่พอ — ต้องมีความเร็ว > 8 km/h และรอบ > 1200 ขณะกด'; return; }
      acc.sort((a, b) => a - b); const med = acc[acc.length >> 1];
      const r = P.parseRatios(S.gearRatios || DEFAULT_RATIOS[S.gears || 6]); while (r.length < (S.gears || 6)) r.push(r[r.length - 1] * 0.85);
      r[g - 1] = Math.round(med * 10) / 10; S.gearRatios = r.join(' '); S.gearLearned = true; C.saveS(); $('#sRatios').value = S.gearRatios;
      msg.textContent = 'บันทึกเกียร์ ' + g + ' = ' + med.toFixed(1) + ' rpm/(km/h) แล้ว';
    };
    refresh();
  })();

  /* ---------- derived values (only when the ECU/gauge does not provide them) ---------- */
  let baro = null, runStart = null, lastT = null, dist = 0;
  const hook = (d) => {
    const now = d.t || Date.now();
    // barometric estimate: MAP with engine stopped / cranking, else sea-level default
    if (d.MAP != null && d.RPM != null && d.RPM < 100) baro = d.MAP;
    const B0 = baro || 101;
    if (d.BARO == null && d.MAP != null) { d.BARO = B0; d.baroEst = 1; }
    if (d.LOAD == null && d.MAP != null && d.RPM > 0) d.LOAD = Math.max(0, Math.min(100, d.MAP / B0 * 100));
    if (d.ABSL == null && d.LOAD != null) d.ABSL = d.LOAD;
    if (d.AFR == null && d.LAMB != null && d.LAMB > 0.5 && d.LAMB < 2 && !(st.t && st.t.fuel === 'd')) d.AFR = d.LAMB * 14.7;   // car wideband (OBD PID 34) → AFR Log
    if (d.AFR != null) { if (d.LAMB == null) d.LAMB = d.AFR / 14.7; if (d.EQR == null && d.LAMB > 0) d.EQR = 1 / d.LAMB; }
    if (d.RPM > 300) { if (runStart == null) runStart = now; d.RUNT = Math.round((now - runStart) / 1000); } else if (runStart != null) d.RUNT = Math.round((now - runStart) / 1000);
    const sp = d.SPD != null ? d.SPD : d.GPS;
    if (sp != null && lastT != null && now > lastT && now - lastT < 2000) dist += sp * (now - lastT) / 3.6e6;
    lastT = now; if (d.DISTC == null) d.DISTC = Math.round(dist * 100) / 100;
    if (d.FRATE == null && d.INJ > 0.3 && d.RPM > 300 && S.injFlow > 0) {     // L/h from injector pulse: (pulse - dead time) x flow x injections/s
      d.FRATE = Math.max(0, (d.INJ - 0.6) / 1000 * (S.injFlow / 60) * (d.RPM / 120) * 3.6); d.frateEst = 1;
    }
    if (d.FRATE != null && d.KPL == null) d.KPL = d.FRATE > 0.05 && sp > 3 ? sp / d.FRATE : 0;
    if (d.TPSR == null && d.TPS != null) d.TPSR = d.TPS;
    if (d.CMDT == null && d.TPS != null) d.CMDT = d.TPS;
  };
  (window.JetDeriveHooks = window.JetDeriveHooks || []).push(hook);
  window.addEventListener('jetlang', refresh);
})();
