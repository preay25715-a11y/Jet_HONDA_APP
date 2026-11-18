/* =====================================================================
 * Jet Smart Gauge — license.js
 * Offline licence check. A licence is  base64url(JSON) "." base64url(Ed25519 signature)
 * issued by the shop for ONE device id (optionally with an expiry date).
 * Only the PUBLIC key lives in the app; the private key never ships.
 * ===================================================================== */
(function (root) {
  'use strict';
  const PUB_HEX = '8d25fa2977c9d96bbb911eaeab9f281ac1acc7afe953ba66a3a574a6fd5aa5ea';
  const hex2b = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
  const b64u2b = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const r = atob(s), o = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; };
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }, del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  const fmtId = (h) => h.slice(0, 5).toUpperCase() + '-' + h.slice(5, 10).toUpperCase();

  function deviceId() {
    let id = null;
    try { if (root.JetNative && JetNative.deviceId) id = String(JetNative.deviceId() || ''); } catch (e) { id = null; }
    if (id && /^[0-9a-fA-F]{10}/.test(id)) return fmtId(id);
    let s = LS.get('jht.devid');
    if (!s) { const a = new Uint8Array(5); (root.crypto || root.msCrypto).getRandomValues(a); s = Array.from(a, (x) => x.toString(16).padStart(2, '0')).join(''); LS.set('jht.devid', s); }
    return fmtId(s);
  }

  // → { ok, reason, name, exp }   reason: 'none' | 'format' | 'sig' | 'device' | 'expired' | 'clock'
  function check(key) {
    key = String(key || '').replace(/\s+/g, '');
    if (!key) return { ok: false, reason: 'none' };
    try {
      const [p, s] = key.split('.'); if (!p || !s) return { ok: false, reason: 'format' };
      const pb = b64u2b(p), sig = b64u2b(s);
      if (sig.length !== 64 || !root.nacl || !nacl.sign.detached.verify(pb, sig, hex2b(PUB_HEX))) return { ok: false, reason: 'sig' };
      const j = JSON.parse(new TextDecoder().decode(pb));
      if (String(j.d || '').toUpperCase() !== deviceId()) return { ok: false, reason: 'device' };
      const now = Date.now(), exp = (+j.e || 0) * 1000;
      if (exp) {
        const seen = +LS.get('jht.seen') || 0;
        if (now < seen - 86400000) return { ok: false, reason: 'clock' };
        if (now > exp) return { ok: false, reason: 'expired', name: j.n, exp };
        if (now > seen) LS.set('jht.seen', String(now));
      }
      return { ok: true, name: j.n || '', exp };
    } catch (e) { return { ok: false, reason: 'format' }; }
  }

  let state = { ok: false };
  const $ = (s) => document.querySelector(s);
  const MSG = {
    none: '', format: 'รูปแบบ License ไม่ถูกต้อง — คัดลอกให้ครบทุกตัวอักษร', sig: 'License ไม่ถูกต้อง', device: 'License นี้ออกให้เครื่องอื่น (รหัสเครื่องไม่ตรง)',
    expired: 'License หมดอายุแล้ว — ติดต่อ เปรียวจูนเนอร์ เพื่อต่ออายุ', clock: 'นาฬิกาเครื่องผิดปกติ — ตั้งวันเวลาให้ถูกต้องแล้วลองใหม่',
  };
  function show(reason) {
    const el = $('#lic'); if (!el) return;
    $('#licId').textContent = deviceId();
    const m = $('#licMsg'); m.textContent = MSG[reason] || ''; m.className = 'licmsg' + (reason && reason !== 'none' ? ' bad' : '');
    el.classList.add('show'); document.body.classList.add('locked');
  }
  function hide() { const m = $('#licMsg'); if (m) m.textContent = ''; const el = $('#lic'); if (el) el.classList.remove('show'); document.body.classList.remove('locked'); }
  function info() {
    const e = $('#licInfo'); if (!e) return;
    const dt = state.exp ? new Date(state.exp).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'ถาวร';
    e.innerHTML = '<span>เจ้าของ</span><span>' + (state.name || '—').replace(/[<>&]/g, '') + '</span><span>รหัสเครื่อง</span><span>' + deviceId() + '</span><span>หมดอายุ</span><span>' + dt + '</span>';
  }
  function verifyStored() {
    const r = check(LS.get('jht.lic'));
    state = r; if (r.ok) { hide(); info(); } else show(r.reason);
    return r.ok;
  }
  function activate() {
    const k = $('#licKey').value, r = check(k);
    if (!r.ok) { show(r.reason === 'none' ? 'format' : r.reason); return; }
    LS.set('jht.lic', k.replace(/\s+/g, '')); state = r; hide(); info();
    if (root.JetCore) root.JetCore.toast('เปิดใช้งานสำเร็จ — สวัสดี ' + (r.name || ''));
  }
  root.JetLic = { ok: () => !!state.ok, deviceId, check, verify: verifyStored };
  const start = () => {
    $('#licBtn').onclick = activate;
    $('#licCopy').onclick = () => { const t = deviceId(); try { navigator.clipboard.writeText(t); } catch (e) { /* ignore */ } const b = $('#licCopy'); b.textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => (b.textContent = 'คัดลอก'), 1500); };
    $('#licPaste').onclick = async () => { try { $('#licKey').value = await navigator.clipboard.readText(); } catch (e) { $('#licKey').focus(); } };
    if (root.JET_DEV) { state = { ok: true, name: 'DEV' }; hide(); info(); return; }
    verifyStored();
    setInterval(() => { if (state.ok && !check(LS.get('jht.lic')).ok) verifyStored(); }, 60000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
