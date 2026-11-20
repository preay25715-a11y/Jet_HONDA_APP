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
    B(['yam', 'Yamaha XMAX (ตั้งค่ารุ่น — ไม่ใช่ OBD-II/Honda ต่อ ECU ไม่ได้)'], [
      ['XMAX 300 (2017)', 292, 0, 9000], ['XMAX 300 (2018)', 292, 0, 9000], ['XMAX 300 (2019)', 292, 0, 9000], ['XMAX 300 (2020)', 292, 0, 9000], ['XMAX 300 (2021)', 292, 0, 9000], ['XMAX 300 (2022)', 292, 0, 9000], ['XMAX 300 (2023)', 292, 0, 9000], ['XMAX 300 (2024)', 292, 0, 9000], ['XMAX 300 (2025)', 292, 0, 9000], ['XMAX 300 Tech MAX / SP', 292, 0, 9000],
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
    [/^XMAX 300 \((2017|2018|2019|2020|2021|2022)\)|^XMAX 300 Tech/, 13, 0, 1, 0], [/^XMAX 300 \((2023|2024|2025)\)/, 13.2, 0, 1, 0],   // Yamaha: 292 cc single, 20.6 kW @ 7,250 rpm; redline not published here → no shift light
  ];
  BIKES.forEach((b) => {
    const j = JD.find((r) => r[0].test(b.name)); if (!j) return;
    b.tank = j[1]; b.red = j[2]; b.cyl = j[3]; b.inj = j[4];
    if (j[5] && GSET[j[5]]) b.gset = GSET[j[5]];
    if (j[2]) b.rpm = Math.ceil((j[2] + 500) / 1000) * 1000;       // gauge scale = redline + a little
  });

  /* ---------- cars (Thai market) — data from the Smart Gauge CAR project: [brand, name, flags (1 diesel, 2 hybrid, 4 turbo), tank L, cc, redline/100] ---------- */
  const BRANDS = ['Toyota', 'Honda', 'Isuzu', 'Mitsubishi', 'Nissan', 'Mazda'];
  const CARS = [
    [0, "VIOS", 0, 42, 1496, 66],
    [0, "YARIS", 0, 42, 1197, 66],
    [0, "YARIS ATIV", 0, 42, 1197, 66],
    [0, "ALTIS", 0, 55, 1798, 66],
    [0, "ALTIS HYBRID", 2, 43, 1798, 60],
    [0, "CAMRY", 0, 60, 2494, 66],
    [0, "CAMRY HYBRID", 2, 50, 2487, 60],
    [0, "COROLLA CROSS", 0, 47, 1798, 66],
    [0, "FORTUNER", 5, 80, 2393, 47],
    [0, "HILUX REVO", 5, 80, 2393, 47],
    [0, "INNOVA", 5, 55, 2393, 47],
    [0, "COMMUTER", 5, 70, 2755, 46],
    [1, "CITY", 0, 40, 1497, 68],
    [1, "CITY TURBO", 4, 40, 998, 62],
    [1, "CITY HEV", 2, 40, 1498, 62],
    [1, "CIVIC", 0, 47, 1799, 68],
    [1, "CIVIC TURBO", 4, 47, 1498, 62],
    [1, "JAZZ", 0, 40, 1497, 68],
    [1, "BRIO", 0, 35, 1199, 66],
    [1, "MOBILIO", 0, 42, 1497, 66],
    [1, "BR-V", 0, 42, 1497, 66],
    [1, "HR-V", 0, 50, 1799, 66],
    [1, "CR-V", 0, 58, 2356, 66],
    [1, "ACCORD", 0, 56, 1998, 66],
    [2, "D-MAX 1.9", 5, 76, 1898, 48],
    [2, "D-MAX 3.0", 5, 76, 2999, 46],
    [2, "D-MAX 2.5", 5, 76, 2499, 46],
    [2, "MU-X 1.9", 5, 80, 1898, 48],
    [2, "MU-X 3.0", 5, 80, 2999, 46],
    [2, "MU-7", 5, 65, 2999, 46],
    [3, "TRITON 2.4", 5, 75, 2442, 46],
    [3, "TRITON 2.5", 5, 75, 2477, 46],
    [3, "PAJERO SPORT", 5, 68, 2442, 46],
    [3, "PAJERO 3.2", 5, 88, 3200, 45],
    [3, "MIRAGE", 0, 35, 1193, 66],
    [3, "ATTRAGE", 0, 42, 1193, 66],
    [3, "XPANDER", 0, 45, 1499, 66],
    [3, "LANCER EX", 0, 59, 1998, 68],
    [3, "OUTLANDER PHEV", 2, 45, 2360, 58],
    [4, "ALMERA 1.0T", 4, 41, 999, 62],
    [4, "ALMERA 1.2", 0, 41, 1198, 66],
    [4, "MARCH", 0, 41, 1198, 66],
    [4, "NOTE", 0, 41, 1198, 66],
    [4, "NOTE E-POWER", 2, 41, 1198, 60],
    [4, "KICKS E-POWER", 2, 41, 1198, 60],
    [4, "SYLPHY", 0, 52, 1598, 66],
    [4, "TEANA", 0, 68, 1997, 66],
    [4, "X-TRAIL", 0, 60, 1997, 66],
    [4, "NAVARA", 5, 80, 2488, 45],
    [4, "TERRA", 5, 80, 2298, 45],
    [5, "MAZDA 2", 0, 44, 1496, 66],
    [5, "MAZDA 2 DIESEL", 5, 44, 1498, 52],
    [5, "MAZDA 3", 0, 51, 1998, 66],
    [5, "CX-3", 0, 48, 1998, 66],
    [5, "CX-30", 0, 51, 1998, 66],
    [5, "CX-5", 0, 56, 1998, 66],
    [5, "CX-5 DIESEL", 5, 58, 2191, 52],
    [5, "CX-8", 5, 74, 2191, 52],
    [5, "MAZDA 6", 0, 62, 1998, 66],
    [5, "BT-50 1.9", 5, 80, 1898, 48],
    [5, "BT-50 3.2", 5, 80, 3198, 46],
    [5, "MX-5", 0, 45, 1998, 72]
  ];
  CARS.forEach((r) => {
    const red = r[5] * 100;
    BIKES.push({ id: 'car-' + BRANDS[r[0]].toLowerCase() + '-' + r[1].toLowerCase().replace(/[^a-z0-9]+/g, ''), group: 'รถยนต์ ' + BRANDS[r[0]] + ' (OBD-II)', name: r[1], cc: r[4], gears: 0,
      rpm: Math.ceil((red + 500) / 1000) * 1000, tank: r[3], red, cyl: 4, inj: 0, car: true, brand: r[0], d: !!(r[2] & 1), h: !!(r[2] & 2), t: !!(r[2] & 4) });
  });
  // VIN world-manufacturer codes -> brand index (0..5 = BRANDS, 100+ = another make that is only named)
  const OTHER = ['Ford', 'Suzuki', 'MG', 'Chevrolet', 'Subaru', 'BMW', 'Hino', 'GWM', 'Mercedes-Benz', 'Volvo', 'Kia', 'Hyundai'];
  const WMIS = [['MR0', 0], ['MR1', 0], ['MR2', 0], ['JT', 0], ['4T1', 0], ['2T1', 0], ['5TD', 0], ['MHF', 0], ['SB1', 0],
    ['MRH', 1], ['JHM', 1], ['JH1', 1], ['1HG', 1], ['2HG', 1], ['19X', 1], ['SHH', 1], ['MHR', 1], ['LHG', 1],
    ['MPA', 2], ['MP1', 2], ['JAA', 2], ['JAB', 2], ['JAL', 2], ['JAC', 2],
    ['MMA', 3], ['MMB', 3], ['MMC', 3], ['MMD', 3], ['MMT', 3], ['ML3', 3], ['JA3', 3], ['JA4', 3], ['JA7', 3], ['JMB', 3], ['JMY', 3], ['JMA', 3],
    ['MNT', 4], ['MDH', 4], ['JN1', 4], ['JN6', 4], ['JN8', 4], ['SJN', 4], ['3N1', 4], ['1N4', 4],
    ['MM0', 5], ['MM6', 5], ['MM7', 5], ['MM8', 5], ['MP2', 5], ['JM1', 5], ['JM2', 5], ['JM6', 5], ['JM7', 5], ['JMZ', 5], ['JM0', 5], ['3MZ', 5], ['3MV', 5],
    ['MNA', 100], ['MNB', 100], ['MNC', 100], ['MPB', 100], ['MMS', 101], ['MML', 102], ['MMM', 103], ['MMR', 104], ['MMF', 105], ['WBA', 105],
    ['MNK', 106], ['MNU', 107], ['WDB', 108], ['WDD', 108], ['YV1', 109], ['KNA', 110], ['KMH', 111]];
  // Honda motorcycle plants (Thai Honda MLH, Japan JH2/JH3, Vietnam RLH, Indonesia MH1, India ME4, Italy ZDC, China LAL/LWB, USA 1HF)
  const HWMI = ['MLH', 'JH2', 'JH3', 'RLH', 'MH1', 'ME4', 'ZDC', 'LAL', 'LWB', '1HF', '478'];
  const COUNTRY = (v) => {
    const a = v[0], b = v[1];
    if (a === 'M') return b <= 'E' ? 'อินเดีย' : b <= 'K' ? 'อินโดนีเซีย' : b <= 'R' ? 'ไทย' : 'เอเชียอื่น';
    if (a === 'R') return b >= 'L' && b <= 'R' ? 'เวียดนาม' : b >= 'F' && b <= 'K' ? 'ไต้หวัน' : '';
    return ({ J: 'ญี่ปุ่น', K: 'เกาหลี', L: 'จีน', W: 'เยอรมนี', S: 'อังกฤษ', V: 'ฝรั่งเศส/สเปน', Z: 'อิตาลี', 1: 'สหรัฐฯ', 4: 'สหรัฐฯ', 5: 'สหรัฐฯ', 2: 'แคนาดา', 3: 'เม็กซิโก', 6: 'ออสเตรเลีย', 9: 'บราซิล' })[a] || '';
  };
  // Mazda Thailand: model from VIN characters 4-5 (same decode as the CAR gauge)
  const mazdaModel = (v) => {
    const a = v[3], b = v[4];
    if (a === 'D' && 'JEW'.includes(b)) return 'MAZDA 2'; if (a === 'B' && 'MNPLK'.includes(b)) return 'MAZDA 3'; if (a === 'G' && 'JHL'.includes(b)) return 'MAZDA 6';
    if (a === 'K' && 'EF'.includes(b)) return 'CX-5'; if (a === 'D' && b === 'K') return 'CX-3'; if (a === 'D' && b === 'M') return 'CX-30'; if (a === 'N' && b === 'D') return 'MX-5';
    return '';
  };
  /** VIN -> { brand index / name, moto, country, year (approx.), model (when the code is known) } */
  P.identifyVin = (vin) => {
    vin = String(vin || '').toUpperCase(); if (vin.length < 11) return null;
    const o = { vin, brand: -1, brandName: '', moto: false, country: COUNTRY(vin), model: '' };
    if (HWMI.some((w) => vin.startsWith(w))) { o.brand = 1; o.brandName = 'Honda'; o.moto = true; }
    else { const w = WMIS.find((x) => vin.startsWith(x[0])); if (w) { o.brand = w[1]; o.brandName = w[1] < 6 ? BRANDS[w[1]] : OTHER[w[1] - 100] || ''; } }
    const y = 'ABCDEFGHJKLMNPRSTVWXY'.indexOf(vin[9]); o.year = y >= 0 ? 2010 + y : /[1-9]/.test(vin[9]) ? 2000 + +vin[9] : 0;
    if (o.brand === 5) o.model = mazdaModel(vin);
    return o;
  };
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
    C.saveS(); refresh(); window.dispatchEvent(new Event('jetvehicle'));
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
    blk.innerHTML = `<h3 style="margin-top:16px">🏍🚗 รุ่นรถ</h3><div class="gsect">
      <label class="f">เลือกรุ่นรถ<select id="sBike"><option value="">— เลือกรุ่น —</option>${groups.map((g) => `<optgroup label="${g}">${BIKES.filter((b) => b.group === g).map((b) => `<option value="${b.id}">${b.name}${b.cc ? ' · ' + b.cc + ' cc' : ''}${b.gears ? ' · ' + b.gears + ' สปีด' : ' · CVT'}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <div class="mut" id="sVeh" style="margin:6px 0;font-size:13px"></div>
      <div class="row" style="margin:4px 0 8px"><button class="btn" id="sTilesAuto">↺ ช่องหน้าหลัก: ให้แอปเลือกอัตโนมัติ</button></div>
      <label class="f">แหล่งค่า AFR (OBD-II)<select id="sAfrSrc"><option value="auto">อัตโนมัติ (Lambda → O2 → ECU สั่ง)</option><option value="wb">Lambda ไวด์แบนด์ (PID 24/34)</option><option value="o2">เซ็นเซอร์ O2 (ค่าประมาณ)</option><option value="cmd">ค่าที่ ECU สั่ง (PID 44)</option></select></label>
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
      $('#sAfrSrc').value = S.afrSrc || 'auto'; $('#sBike').value = S.bike || ''; $('#sGears').value = S.gears != null ? S.gears : 6; $('#sRpmMax').value = S.rpmMax || 12000; $('#sRatios').value = S.gearRatios || ''; $('#sTank').value = S.tankL || ''; $('#sInj').value = S.injFlow || ''; $('#sRed').value = S.redline || '';
      const n = +$('#sGears').value; $('#sLg').innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">เกียร์ ${i + 1}</option>`).join('');
      $('#gearLearn').style.display = n ? '' : 'none';
    };
    $('#bSet').addEventListener('click', fill);
    $('#sBike').onchange = () => { const b = byId($('#sBike').value); if (b) { S.bikeUser = true; apply(b, false); fill(); toast('ตั้งค่ารุ่น ' + b.name + ' แล้ว'); } };
    $('#sAfrSrc').onchange = () => { S.afrSrc = $('#sAfrSrc').value; C.saveS(); if (st.t && st.t.kind === 'obd') st.t.afrPref = S.afrSrc; toast('แหล่งค่า AFR: ' + $('#sAfrSrc').selectedOptions[0].textContent); };
    $('#sTilesAuto').onclick = () => { C.resetTiles(); toast('ช่องหน้าหลักกลับเป็นอัตโนมัติแล้ว'); };
    $('#sGears').onchange = () => { S.gears = Math.max(0, Math.min(8, +$('#sGears').value || 0)); S.cvt = S.gears === 0; if (S.gears && !S.gearRatios) S.gearRatios = DEFAULT_RATIOS[S.gears] || DEFAULT_RATIOS[6]; C.saveS(); refresh(); fill(); };
    $('#sRpmMax').onchange = () => { S.rpmMax = Math.max(3000, +$('#sRpmMax').value || 12000); C.saveS(); window.dispatchEvent(new Event('jetvehicle')); };
    $('#sRatios').onchange = () => { S.gearRatios = $('#sRatios').value.trim(); S.gearLearned = true; C.saveS(); };
    $('#sTank').onchange = () => { S.tankL = Math.max(0, +$('#sTank').value || 0); C.saveS(); };
    $('#sInj').onchange = () => { S.injFlow = Math.max(0, +$('#sInj').value || 0); C.saveS(); };
    $('#sRed').onchange = () => { S.redline = Math.max(0, +$('#sRed').value || 0); C.saveS(); window.dispatchEvent(new Event('jetvehicle')); };
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

  /* ---------- automatic vehicle identification (OBD): VIN brand/year/model + fuel type + hybrid → model defaults ---------- */
  const FUELTH = (t) => (t.fuelType === 5 ? 'LPG' : t.fuelType === 6 ? 'CNG' : t.fuelType === 3 ? 'เอทานอล' : t.fuel === 'd' ? 'ดีเซล' : 'เบนซิน') + (t.hybrid ? ' ไฮบริด' : '');
  P.vehOnObd = (t) => {
    const id = (t && t.ident) || {}, det = id.vin ? P.identifyVin(id.vin) : null, v = { det, fuel: FUELTH(t), model: null, text: '' };
    if (!t || t.honda) {
      v.text = t && t.honda ? 'HONDA PGM-FI (มอเตอร์ไซค์)' : '';
      const c0 = byId(S.bike); if (t && (!c0 || c0.car) && S.bikeBack && byId(S.bikeBack)) { apply(byId(S.bikeBack), true); S.bikeUser = true; }   // back on the bike: restore the bike chosen before a car was detected
      st.veh = v; return v;
    }
    const parts = [];
    let cands = BIKES.filter((b) => b.car && b.d === (t.fuel === 'd') && (t.hybrid ? b.h : !b.h));
    if (!cands.length) cands = BIKES.filter((b) => b.car && b.d === (t.fuel === 'd'));
    if (det && det.brand >= 0 && det.brand < 6) {
      const byBrand = cands.filter((b) => b.brand === det.brand); if (byBrand.length) cands = byBrand;
      if (det.model) { const m = cands.filter((b) => b.name.indexOf(det.model) === 0); if (m.length) cands = m; }
    } else if (det && det.moto) cands = [];
    if (det) parts.push((det.model || det.brandName || 'VIN ' + det.vin.slice(0, 3)) + (det.year ? ' ' + det.year : '') + (det.country ? ' · ' + det.country : ''));
    parts.push(v.fuel);
    if (cands.length === 1 && det && det.brand >= 0) v.model = cands[0];
    v.cands = cands; v.text = parts.join(' · ');
    // apply: a unique model fills everything; otherwise only the generic scale of this brand/fuel (never overrides the user's own car choice)
    const cur = byId(S.bike); if (cur && !cur.car) S.bikeBack = cur.id;
    const keepUser = S.bikeUser && cur && cur.car && (!det || det.brand < 0 || cur.brand === det.brand);
    if (!keepUser) {
      if (v.model) { S.bikeUser = false; apply(v.model, false); }
      else if (cands.length) {
        const red = cands.map((b) => b.red).sort((a, b) => a - b), mid = red[Math.floor(red.length / 2)];
        S.bike = ''; S.bikeUser = false; S.cvt = true; S.gears = 0; S.gearRatios = ''; S.rpmMax = Math.ceil((Math.max.apply(null, red) + 500) / 1000) * 1000; S.redline = mid; S.tankL = 0; S.injFlow = 0;
        C.saveS(); refresh(); window.dispatchEvent(new Event('jetvehicle'));
      }
    }
    st.veh = v;
    const el = $('#sVeh'); if (el) el.textContent = '🔎 ตรวจพบรถ: ' + v.text + (id.vin ? ' · VIN ' + id.vin : '') + (id.cal ? ' · ECU ' + id.cal : '') + (v.model ? ' → ตั้งค่ารุ่น ' + v.model.name + ' ให้อัตโนมัติ' : cands.length > 1 ? ' → เลือกรุ่นที่แน่ชัดได้ที่ช่องด้านบน' : '');
    return v;
  };

  /* ---------- derived values (only when the ECU/gauge does not provide them) ---------- */
  let baro = null, runStart = null, lastT = null, dist = 0, o2f = null, o2t = 0;
  const hook = (d) => {
    const now = d.t || Date.now();
    // barometric estimate: MAP with engine stopped / cranking, else sea-level default
    if (d.MAP != null && d.RPM != null && d.RPM < 100) baro = d.MAP;
    const B0 = baro || 101;
    if (d.BARO == null && d.MAP != null) { d.BARO = B0; d.baroEst = 1; }
    if (d.LOAD == null && d.MAP != null && d.RPM > 0) d.LOAD = Math.max(0, Math.min(100, d.MAP / B0 * 100));
    if (d.ABSL == null && d.LOAD != null) d.ABSL = d.LOAD;
    // AFR over OBD-II: measured lambda (PID 24/34 wideband) x stoichiometric ratio; if the car has none, the ECU's commanded lambda (PID 44) as a target value
    const obd = st.t && st.t.kind === 'obd', stoich = (obd && st.t.stoich) || 14.7, dsl = obd && st.t.fuel === 'd';
    // sources, best first (Setup can force one): wb = measured wideband lambda · o2 = narrowband O2 voltage (PID 14, smoothed, an ESTIMATE) · cmd = lambda the ECU commands (PID 44)
    let o2a = null;
    if (obd && !dsl && d.O2 != null && d.O2 >= 0 && d.O2 <= 1.3) {
      const dt = Math.min(2000, Math.max(30, now - (o2t || now))); o2t = now;
      o2f = o2f == null ? d.O2 : o2f + (d.O2 - o2f) * (1 - Math.exp(-dt / 800));           // the sensor flips 0.1 ↔ 0.9 V with every fuel-trim correction: ~0.8 s average
      o2a = P.o2ToAfr(o2f, stoich);
    } else { o2f = null; o2t = 0; }
    if (d.AFR == null) {
      const okE = obd && d.EQR != null && d.EQR > 0.4 && d.EQR < 3, pref = S.afrSrc || 'auto';
      const cand = { wb: d.LAMB != null && d.LAMB > 0.4 && d.LAMB < (dsl ? 12 : 3) ? d.LAMB * stoich : null, o2: o2a, cmd: okE ? d.EQR * stoich : null };
      for (const k of (pref !== 'auto' ? [pref, 'wb', 'o2', 'cmd'] : ['wb', 'o2', 'cmd'])) if (cand[k] != null) { d.AFR = cand[k]; d.afrSrc = k; break; }
      if (d.afrSrc === 'cmd') d.LAMB = d.EQR;
    } else if (!d.afrSrc) d.afrSrc = 'gauge';
    if (d.AFR != null) { if (d.LAMB == null) d.LAMB = d.AFR / stoich; if (d.EQR == null && d.LAMB > 0) d.EQR = d.LAMB; }
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
