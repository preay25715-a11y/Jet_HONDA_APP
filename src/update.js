/* Jet Smart Gauge — update.js : version display + "check for update" (GitHub Releases) */
(function (root) {
  'use strict';
  const C = root.JetCore, $ = (s) => document.querySelector(s);
  const VER = '@@VERSION@@';
  const num = (v) => String(v).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  const DEF_REPO = 'preay25715-a11y/Jet_HONDA_APP';             // where the Jet Smart Gauge releases live (workflow build-apk.yml)
  const curRepo = () => DEF_REPO;                                  // v1.6.0: fixed and never shown to the user (no field, no link, no address in any message)
  let dl = '';
  const msg = (t) => { $('#updMsg').textContent = t; };
  async function check(silent) {
    const repo = curRepo();
    try {
      if (!silent) msg('กำลังตรวจสอบ…');
      const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 404 ? 'ยังไม่มีข้อมูลเวอร์ชันล่าสุด' : 'HTTP ' + r.status);
      const j = await r.json(), tag = j.tag_name || '';
      const apk = (j.assets || []).find((a) => /\.apk$/i.test(a.name));
      dl = apk ? apk.browser_download_url : '';                          // v1.6.0: only the APK file itself — never the project page
      $('#verNew').textContent = tag || '—';
      C.S.updLast = Date.now(); C.saveS();
      if (newer(tag, VER) && !dl) { $('#updGet').hidden = true; msg('มีเวอร์ชันใหม่ ' + tag + ' แต่ไฟล์อัปเดตยังไม่พร้อม — ลองใหม่ภายหลัง'); }
      else if (newer(tag, VER)) { $('#updGet').hidden = false; msg('มีเวอร์ชันใหม่ ' + tag + ' — กด “อัปเดตเลย” ได้เลย'); if (silent) C.toast('มีเวอร์ชันใหม่ ' + tag + ' (ดูที่ Setup)', 4000); }
      else { $('#updGet').hidden = true; msg('ใช้เวอร์ชันล่าสุดอยู่แล้ว ✓'); }
    } catch (e) { const m = String((e && e.message) || e); if (!silent) msg('ตรวจสอบไม่สำเร็จ: ' + (/^(HTTP \d+|ยังไม่มีข้อมูล)/.test(m) ? m : 'เชื่อมต่อไม่ได้') + ' (ต้องมีอินเทอร์เน็ต)'); }      // v1.6.0: only our own short messages — never a host or an address from a network error
  }
  // v1.6.0: the update source is built into the app; what older versions stored in the settings is removed
  if ('updRepo' in C.S || 'updRepoV' in C.S) { delete C.S.updRepo; delete C.S.updRepoV; C.saveS(); }
  const why = (m) => { const h = /HTTP \d+/.exec(String(m || '')); return h ? h[0] : 'ดาวน์โหลดไม่สำเร็จ'; };      // never show a host / address from a network error
  $('#updCheck').onclick = () => check(false);
  const inApp = () => !!(root.JetNative && JetNative.installApk);
  $('#updGet').onclick = () => {
    if (!dl) return;
    if (inApp() && /\.apk$/i.test(dl)) { msg('กำลังดาวน์โหลด… 0%'); $('#updGet').disabled = true; JetNative.installApk(dl); }
    else if (root.JetNative && JetNative.openUrl) JetNative.openUrl(dl); else window.open(dl, '_blank');
  };
  const prev = root.JetEvt;
  root.JetEvt = (evt, d) => {
    if (evt !== 'upd') return prev && prev(evt, d);
    if (d.s === 'dl') msg('กำลังดาวน์โหลด… ' + d.p + '%');
    else if (d.s === 'done') { msg('ดาวน์โหลดเสร็จ — กด “ติดตั้ง” ในหน้าต่างที่เด้งขึ้นมา'); $('#updGet').disabled = false; }
    else if (d.s === 'perm') { msg('อนุญาต “ติดตั้งแอปที่ไม่รู้จัก” ให้แอปนี้ในหน้าตั้งค่า แล้วกลับมากดอัปเดตอีกครั้ง'); $('#updGet').disabled = false; }
    else { msg('อัปเดตไม่สำเร็จ: ' + why(d.m) + ' — ลองกดอีกครั้ง'); $('#updGet').disabled = false; }
  };
  // quiet check at most once a day, only after the licence is OK
  setTimeout(() => { if (root.JetLic && JetLic.ok() && curRepo() && Date.now() - (C.S.updLast || 0) > 86400000) check(true); }, 6000);
  root.JET_VERSION = VER;
})(window);
