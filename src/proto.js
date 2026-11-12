/* =====================================================================
 * Jet_HONDA Tune — proto.js
 * Honda / Keihin K-line framing, checksums, MFB-LINK (Smart Gauge) framing,
 * DTC table, live-data decoding, model database.
 *
 * Protocol facts ported from the open-source GPL projects
 *   eculib/honda.py (RyanHope / forks) and TunerPro-HondaECU (AlexDev-TH).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = {};

  /* ---------- checksums ---------- */
  P.sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  // checksum8bitHonda: two's complement of byte sum -> whole frame sums to 0
  P.ckHonda = (a) => ((P.sum(a) ^ 0xFF) + 1) & 0xFF;
  // checksum8bit (used as 1st checksum in write blocks)
  P.ck8 = (a) => (0xFF - ((P.sum(a) - 1) >> 8)) & 0xFF;

  /* ---------- K-line frame ---------- */
  // frame = mtype + [len] + data + [ck] ; len = total frame length
  P.buildFrame = (mtype, data) => {
    data = data || [];
    const f = [...mtype, 2 + mtype.length + data.length, ...data];
    f.push(P.ckHonda(f));
    return f;
  };
  P.parseReply = (buf, ml) => {
    if (!buf || buf.length < ml + 1) return null;
    const len = buf[ml];
    if (len < ml + 2 || buf.length < len) return null;
    const fr = Array.from(buf.slice(0, len));
    if ((P.sum(fr) & 0xFF) !== 0) return { bad: true };
    return { mtype: fr.slice(0, ml), len, data: fr.slice(ml + 1, len - 1), raw: fr };
  };
  // reply header rules
  P.matchType = (mt, rt) => {
    if (mt.length === 3) return rt[0] === (mt[0] | 0x10) && rt[1] === (mt[1] | 0x10);
    if (mt.length === 2) return rt[0] === mt[0] && rt[1] === mt[1];
    return rt[0] === (mt[0] & 0x0F);
  };
  // 24-bit flash address -> [bits16-23, bits0-7, bits8-15]
  P.fmtRead = (a) => [(a >> 16) & 0xFF, a & 0xFF, (a >> 8) & 0xFF];

  P.hex = (a, sep = ' ') => Array.from(a || []).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(sep);
  P.h8 = (b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0');
  P.hx = (n, w = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(w, '0');
  P.parseHexBytes = (s) => {
    s = (s || '').trim();
    if (!s) return [];
    if (/^ascii:/i.test(s)) return Array.from(s.slice(6)).map((c) => c.charCodeAt(0) & 0xFF);
    const t = s.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    if (t.length % 2) throw new Error('hex ต้องเป็นจำนวนคู่');
    const o = []; for (let i = 0; i < t.length; i += 2) o.push(parseInt(t.substr(i, 2), 16));
    return o;
  };

  /* ---------- binary file checksum ---------- */
  P.binSum8 = (u8) => { let s = 0; for (let i = 0; i < u8.length; i++) s = (s + u8[i]) & 0xFF; return s; };
  P.binChecksumOK = (u8) => P.binSum8(u8) === 0;
  // set byte at idx so whole image sums to 0 (do_validation fix)
  P.binFixChecksum = (u8, idx) => {
    const o = new Uint8Array(u8);
    if (idx < 0 || idx >= o.length) throw new Error('ตำแหน่ง checksum อยู่นอกไฟล์');
    o[idx] = 0;
    o[idx] = (0x100 - P.binSum8(o)) & 0xFF;
    return o;
  };
  P.crc32 = (u8) => {
    let c, crc = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) {
      c = (crc ^ u8[i]) & 0xFF;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };

  /* ---------- MFB-LINK : app <-> Smart Gauge (BLE / USB) ----------
   * [0x55 0xAA][type][lenL lenH][payload...][xor(type..payload)]
   * response type = request | 0x80, payload[0] = status (0 = OK)      */
  P.LINK = {
    PING: 0x01, WAKE: 0x02, TXRX: 0x03, SENSE: 0x04,
    FILE_BEGIN: 0x10, FILE_CHUNK: 0x11, FILE_END: 0x12, FILE_LIST: 0x13, SENSORS: 0x20,
    ST_OK: 0, ST_TIMEOUT: 1, ST_ERR: 2,
  };
  P.linkEncode = (type, payload) => {
    payload = payload || [];
    const f = [0x55, 0xAA, type, payload.length & 0xFF, (payload.length >> 8) & 0xFF, ...payload];
    let x = type; for (const b of payload) x ^= b; x ^= f[3] ^ f[4];
    f.push(x & 0xFF);
    return f;
  };
  P.LinkParser = class {
    constructor(onFrame) { this.b = []; this.onFrame = onFrame; }
    push(bytes) {
      for (const v of bytes) this.b.push(v);
      for (;;) {
        while (this.b.length >= 2 && !(this.b[0] === 0x55 && this.b[1] === 0xAA)) this.b.shift();
        if (this.b.length < 6) return;
        const n = this.b[3] | (this.b[4] << 8);
        if (this.b.length < 6 + n) return;
        const fr = this.b.splice(0, 6 + n);
        let x = fr[2] ^ fr[3] ^ fr[4]; for (let i = 5; i < 5 + n; i++) x ^= fr[i];
        if ((x & 0xFF) !== fr[5 + n]) continue; // bad frame, drop
        this.onFrame(fr[2], fr.slice(5, 5 + n));
      }
    }
  };

  /* ---------- ECU states ---------- */
  P.STATE = { OFF: 'OFF', UNKNOWN: 'UNKNOWN', OK: 'OK', SECURE: 'SECURE', READ: 'READ',
    RECOVER_OLD: 'RECOVER_OLD', RECOVER_NEW: 'RECOVER_NEW', FLASH: 'FLASH', ERROR: 'ERROR' };
  P.STATE_TH = {
    OFF: 'ไม่พบกล่อง (บิดกุญแจ ON?)', UNKNOWN: 'ไม่ทราบสถานะ', OK: 'ปกติ (พร้อมใช้งาน)',
    SECURE: 'ปลดล็อกแล้ว (อ่านได้)', READ: 'โหมดอ่าน', RECOVER_OLD: 'โหมดกู้ (แฟลชค้าง-แบบเก่า)',
    RECOVER_NEW: 'โหมดกู้ (แฟลชค้าง-แบบใหม่)', FLASH: 'โหมดแฟลช (บูตโหลดเดอร์)', ERROR: 'ผิดพลาด',
  };

  /* ---------- Honda PGM-FI DTC (blink-code style "N-N") ---------- */
  P.DTC = {
    '1-1': 'MAP sensor แรงดันต่ำ', '1-2': 'MAP sensor แรงดันสูง',
    '7-1': 'ECT/EOT sensor แรงดันต่ำ', '7-2': 'ECT/EOT sensor แรงดันสูง',
    '8-1': 'TPS แรงดันต่ำ', '8-2': 'TPS แรงดันสูง',
    '9-1': 'IAT sensor แรงดันต่ำ', '9-2': 'IAT sensor แรงดันสูง',
    '11-1': 'Vehicle speed sensor', '12-1': 'หัวฉีด (สูบ 1)', '13-1': 'หัวฉีด (สูบ 2)',
    '21-1': 'O2 sensor', '23-1': 'O2 sensor heater', '29-1': 'IACV / ISC valve',
    '33-2': 'EEPROM ใน ECU', '54-1': 'Bank angle sensor แรงดันต่ำ', '54-2': 'Bank angle sensor แรงดันสูง',
  };
  P.dtcText = (k) => P.DTC[k] || 'ไม่มีคำอธิบายในฐานข้อมูล (ดูคู่มือซ่อมรุ่นนั้น)';

  /* ---------- Live data : table 0x11 (community-decoded layout) ----------
   * rdata = [0x71, 0x11, v0..vn]. Adjust here if a model differs.          */
  P.decodeT11 = (rdata) => {
    const v = rdata.slice(2);
    if (v.length < 14) return null;
    const g = (i) => (i < v.length ? v[i] : null);
    const o = {
      RPM: (g(0) << 8) | g(1),
      TPS_V: +(g(2) * 5 / 256).toFixed(2),
      TPS: +(g(3) / 1.6).toFixed(1),
      ECT_V: +(g(4) * 5 / 256).toFixed(2),
      ECT: g(5) - 40,
      IAT_V: +(g(6) * 5 / 256).toFixed(2),
      IAT: g(7) - 40,
      MAP_V: +(g(8) * 5 / 256).toFixed(2),
      MAP: g(9),
      BATT: +(g(12) / 10).toFixed(1),
      SPD: g(13),
    };
    if (v.length >= 16) o.INJ = +(((g(14) << 8) | g(15)) / 250).toFixed(2);
    if (v.length >= 17) o.IGN = +(g(16) / 2 - 64).toFixed(1);
    return o;
  };

  /* ---------- model database ----------
   * size KB, start = ECU address of file byte 0, cks = checksum byte index in file.
   * src: 'HondaECU' = from the HondaECU checksum table ; 'family' = default for the
   * small Keihin scooter/underbone ECU family -> MUST be confirmed by reading first.  */
  P.MODELS = [
    { id: 'auto', name: 'AUTO — ตรวจจากการดูดไฟล์', size: 0, start: 0, cks: 0, src: 'auto' },
    // --- Thai market small-cc (Keihin small ECU family) ---
    ...[
      'Wave 110i', 'Wave 125i', 'Dream Super Cub / Super Cub 110', 'Scoopy-i', 'Zoomer-X', 'Moove',
      'Click 110i', 'Click 125i', 'Click 150i', 'Click 160', 'Spacy-i', 'Lead 125', 'Giorno+',
      'PCX 125', 'PCX 150', 'PCX 160', 'ADV 150', 'ADV 160', 'Monkey 125', 'CT125', 'Dax 125',
      'MSX125 SF / Grom', 'CBR150R', 'CB150R', 'Supra GTR150', 'Sonic 150 (FI)',
    ].map((n, i) => ({ id: 'th' + i, name: n, size: 64, start: 0x8000, cks: 0, src: 'family' })),
    // --- entries from the HondaECU checksum table ---
    { id: 'msx17', name: 'MSX125 2017 (38770-K26-B13)', size: 64, start: 0x8000, cks: 0x0, src: 'HondaECU' },
    { id: 'msx14', name: 'MSX125 2014 (38770-K26-911)', size: 48, start: 0x4000, cks: 0x0, src: 'HondaECU' },
    { id: 'crf110', name: 'CRF110F 2019 (38770-KYK-D12)', size: 64, start: 0x8000, cks: 0x0, src: 'HondaECU' },
    { id: 'cbr250', name: 'CBR250R 2011-13 (38770-KYJ)', size: 56, start: 0, cks: 0xDFEF, src: 'HondaECU' },
    { id: 'cbr300h', name: 'CBR300R HRC (38770-K33-R01)', size: 256, start: 0, cks: 0x18FFE, src: 'HondaECU' },
    { id: 'cbr250rr', name: 'CBR250RR HRC 2017 (38770-K64-R02)', size: 1024, start: 0, cks: 0x7FFF8, src: 'HondaECU' },
    { id: 'cb500', name: 'CB500 2014 (38770-MGZ)', size: 256, start: 0, cks: 0x3FFF8, src: 'HondaECU' },
    { id: 'cb650f', name: 'CB650F 2015 (38770-MJE)', size: 256, start: 0, cks: 0x3FFF8, src: 'HondaECU' },
    { id: 'nc750x', name: 'NC750X 2015', size: 256, start: 0, cks: 0x3FFF8, src: 'HondaECU' },
    { id: 'nc750s', name: 'NC750S 2016 (38770-MJL)', size: 512, start: 0, cks: 0x7FFF8, src: 'HondaECU' },
    { id: 'cbr600', name: 'CBR600RR 2007-16', size: 256, start: 0, cks: 0x3FFF8, src: 'HondaECU' },
    { id: 'cbr1000a', name: 'CBR1000RR 2004-05', size: 256, start: 0, cks: 0x3FFFC, src: 'HondaECU' },
    { id: 'cbr1000b', name: 'CBR1000RR 2006-16', size: 256, start: 0, cks: 0x3FFF8, src: 'HondaECU' },
    { id: 'cb1000r', name: 'CB1000R 2008-16', size: 256, start: 0, cks: 0x3FFF8, src: 'HondaECU' },
    { id: 'custom', name: 'กำหนดเอง', size: 0, start: 0, cks: 0, src: 'custom' },
  ];

  /* ---------- auto-detect Start Offset / checksum location from a .bin ----------
   * Rules from the HondaECU checksum table + Keihin small-ECU family.
   * When several checksum spots are possible for a size, pick the one sitting in
   * padding (0xFF / 0x00 around it) — that is where Honda puts the checksum byte. */
  P.LAYOUTS = {
    48: { start: 0x4000, cks: [0x0], why: '48KB = Keihin เล็ก (เช่น MSX125 2014)' },
    56: { start: 0x0, cks: [0xDFEF], why: '56KB = CBR250R / CB300 / SH300' },
    64: { start: 0x8000, cks: [0x0], why: '64KB = Keihin เล็ก (Wave / Click / PCX / MSX…)' },
    256: { start: 0x0, cks: [0x3FFF8, 0x18FFE, 0x19FFE, 0x1FFFA, 0x3FFFC], why: '256KB = Keihin M16C/M32R' },
    512: { start: 0x0, cks: [0x7FFF8], why: '512KB = NC750 / VFR800' },
    1024: { start: 0x0, cks: [0xFFFF8, 0x7FFF8], why: '1MB = CBR1000RR 2017 / VFR1200 / CBR250RR' },
  };
  P.padScore = (u8, i) => {
    let s = 0;
    for (let k = i - 12; k <= i + 12; k++) if (k !== i && k >= 0 && k < u8.length && (u8[k] === 0xFF || u8[k] === 0x00)) s++;
    return s;
  };
  P.detectLayout = (u8, meta) => {
    meta = meta || {};
    const kb = u8.length / 1024, L = P.LAYOUTS[kb];
    let start, cks; const why = [];
    if (meta.startManual != null) { start = meta.startManual; why.push('Start ตั้งเอง'); }
    else if (meta.readStart != null) { start = meta.readStart; why.push('Start จากตอนดูดไฟล์'); }
    else if (L) { start = L.start; why.push(L.why); }
    else { start = 0; why.push('ขนาด ' + kb.toFixed(1) + 'KB ไม่อยู่ในตาราง → Start 0'); }
    if (meta.cksManual != null) { cks = meta.cksManual; why.push('Checksum ตั้งเอง'); }
    else {
      const cands = (L ? L.cks : [u8.length - 8, u8.length - 2, u8.length - 4, 0]).filter((c) => c < u8.length);
      cks = cands[0] || 0;
      if (cands.length > 1) {
        let best = -1;
        for (const c of cands) { const sc = P.padScore(u8, c); if (sc > best) { best = sc; cks = c; } }
        why.push('Checksum เลือกจุดในพื้นที่ว่างของไฟล์');
      }
    }
    return { start, cks, why: why.join(' · '), known: !!L };
  };

  /* ---------- Smart-Gauge sensor block (LINK 0x20) ----------
   * afr u16/100, gpsSpeed u16/10, sats, satsView, lat i32/1e7, lon i32/1e7, eot+40, o2/100, flags
   * flags: b0 AFR valid, b1 GPS fix, b2 EOT valid, b3 O2 valid                                  */
  P.decodeSensors = (p) => {
    if (!p || p.length < 18) return null;
    const u16 = (i) => p[i] | (p[i + 1] << 8), i32 = (i) => (p[i] | (p[i + 1] << 8) | (p[i + 2] << 16) | (p[i + 3] << 24));
    const f = p[17];
    return { afr: u16(0) / 100, spd: u16(2) / 10, sats: p[4], satsView: p[5], lat: i32(6) / 1e7, lon: i32(10) / 1e7, eot: p[14] - 40, o2: p[15] / 100,
      afrOk: !!(f & 1), gpsOk: !!(f & 2), eotOk: !!(f & 4), o2Ok: !!(f & 8), fix: !!(f & 2), t: Date.now() };
  };

  /* ---------- XDF that matches the DEMO ECU image ---------- */
  P.DEMO_XDF = `<XDFFORMAT version="1.60"><XDFHEADER><deftitle>Jet_HONDA DEMO K03-H01</deftitle><BASEOFFSET offset="0" subtract="0" /></XDFHEADER>
<XDFTABLE uniqueid="0x1"><title>น้ำมัน 1-4 (Fuel)</title>
<XDFAXIS id="x"><EMBEDDEDDATA mmedaddress="0x3F80" mmedelementsizebits="16" mmedcolcount="25" /><indexcount>25</indexcount><MATH equation="X/10"><VAR id="X" /></MATH></XDFAXIS>
<XDFAXIS id="y"><EMBEDDEDDATA mmedaddress="0x3F00" mmedelementsizebits="16" mmedrowcount="29" /><indexcount>29</indexcount><MATH equation="X"><VAR id="X" /></MATH></XDFAXIS>
<XDFAXIS id="z"><EMBEDDEDDATA mmedaddress="0x4000" mmedelementsizebits="16" mmedrowcount="29" mmedcolcount="25" /><decimalpl>3</decimalpl><MATH equation="X*0.001"><VAR id="X" /></MATH></XDFAXIS></XDFTABLE>
<XDFTABLE uniqueid="0x2"><title>ไฟจุดระเบิด (Ignition)</title>
<XDFAXIS id="x"><EMBEDDEDDATA mmedaddress="0x3F80" mmedelementsizebits="16" mmedcolcount="25" /><indexcount>25</indexcount><MATH equation="X/10"><VAR id="X" /></MATH></XDFAXIS>
<XDFAXIS id="y"><EMBEDDEDDATA mmedaddress="0x3F00" mmedelementsizebits="16" mmedrowcount="29" /><indexcount>29</indexcount><MATH equation="X"><VAR id="X" /></MATH></XDFAXIS>
<XDFAXIS id="z"><EMBEDDEDDATA mmedaddress="0x4600" mmedelementsizebits="8" mmedrowcount="29" mmedcolcount="25" /><decimalpl>1</decimalpl><MATH equation="X/2-10"><VAR id="X" /></MATH></XDFAXIS></XDFTABLE>
</XDFFORMAT>`;

  P.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
  else root.HP = P;
})(typeof window !== 'undefined' ? window : globalThis);
