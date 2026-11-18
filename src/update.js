/* Jet Smart Gauge — update.js : version display + "check for update" (GitHub Releases) */
(function (root) {
  'use strict';
  const C = root.JetCore, $ = (s) => document.querySelector(s);
  const VER = '@@VERSION@@';
  const num = (v) => String(v).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  const repoOf = (s) => { s = String(s || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, ''); const m = s.match(/^([\w.-]+)\/([\w.-]+)/); return m ? m[1] + '/' + m[2] : ''; };
  let dl = '';
  const msg = (t) => { $('#updMsg').textContent = t; };
  async function check(silent) {
    const repo = repoOf(C.S.updRepo);
    if (!repo) { if (!silent) msg('ใส่ที่อยู่โปรเจกต์ GitHub ก่อน (เช่น ชื่อ/โปรเจกต์)'); return; }
    try {
      if (!silent) msg('กำลังตรวจสอบ…');
      const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 404 ? 'ไม่พบ Release ในโปรเจกต์นี้' : 'HTTP ' + r.status);
      const j = await r.json(), tag = j.tag_name || '';
      const apk = (j.assets || []).find((a) => /\.apk$/i.test(a.name));
      dl = apk ? apk.browser_download_url : j.html_url;
      $('#verNew').textContent = tag || '—';
      C.S.updLast = Date.now(); C.saveS();
      if (newer(tag, VER)) { $('#updGet').hidden = false; msg('มีเวอร์ชันใหม่ ' + tag + ' — กด “อัปเดตเลย” ได้เลย'); if (silent) C.toast('มีเวอร์ชันใหม่ ' + tag + ' (ดูที่ Setup)', 4000); }
      else { $('#updGet').hidden = true; msg('ใช้เวอร์ชันล่าสุดอยู่แล้ว ✓'); }
    } catch (e) { if (!silent) msg('ตรวจสอบไม่สำเร็จ: ' + (e.message || e) + ' (ต้องมีอินเทอร์เน็ต)'); }
  }
  $('#updRepo').value = C.S.updRepo || '';
  $('#updRepo').onchange = () => { C.S.updRepo = $('#updRepo').value.trim(); C.saveS(); };
  $('#updCheck').onclick = () => { C.S.updRepo = $('#updRepo').value.trim(); C.saveS(); check(false); };
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
    else { msg('อัปเดตไม่สำเร็จ: ' + (d.m || '') + ' — ลองกดอีกครั้ง'); $('#updGet').disabled = false; }
  };
  // quiet check at most once a day, only after the licence is OK
  setTimeout(() => { if (root.JetLic && JetLic.ok() && repoOf(C.S.updRepo) && Date.now() - (C.S.updLast || 0) > 86400000) check(true); }, 6000);
  root.JET_VERSION = VER;
})(window);
