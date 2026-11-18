#!/usr/bin/env python3
"""Issue a Jet Smart Gauge licence.

  python3 tools/license_issue.py --seed JET_LICENSE_PRIVATE_SEED.txt --device ABCDE-12345 --name "ชื่อลูกค้า" [--days 365]

--days 0 (default) = lifetime licence.  The private seed is NEVER part of the app/repo: keep it offline.
"""
import argparse, base64, json, time
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ap = argparse.ArgumentParser()
ap.add_argument('--seed', required=True); ap.add_argument('--device', required=True)
ap.add_argument('--name', default=''); ap.add_argument('--days', type=int, default=0)
a = ap.parse_args()
key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(open(a.seed).read().strip()))
now = int(time.time())
payload = json.dumps({'d': a.device.strip().upper(), 'n': a.name, 'e': now + a.days * 86400 if a.days else 0, 'i': now}, ensure_ascii=False, separators=(',', ':')).encode()
b = lambda x: base64.urlsafe_b64encode(x).rstrip(b'=').decode()
print(b(payload) + '.' + b(key.sign(payload)))
