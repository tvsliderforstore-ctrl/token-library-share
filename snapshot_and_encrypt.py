#!/usr/bin/env python3
r"""
snapshot_and_encrypt.py — pull the live Product Token Library dashboard API,
build a single data.json snapshot, and AES-256-GCM encrypt it into
share_site/data.json.enc for the in-browser decrypt gate.

SECURITY: the password is read from the env var DASHBOARD_PASSWORD, or prompted
interactively (getpass, no echo). It is NEVER written to disk or the repo.

File format produced (must match the WebCrypto code in index.html):
    [16 bytes salt][12 bytes IV][AES-256-GCM ciphertext]
Key = PBKDF2(password, salt, 100_000 iters, SHA-256) -> AES-256-GCM.

Usage:
    set DASHBOARD_PASSWORD=yourpw   (Windows cmd)   OR   export DASHBOARD_PASSWORD=yourpw (bash)
    python snapshot_and_encrypt.py
    python snapshot_and_encrypt.py --api http://127.0.0.1:4310
"""
from __future__ import annotations
import argparse, getpass, json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_JSON = os.path.join(HERE, "data.json")
OUT_ENC  = os.path.join(HERE, "data.json.enc")

ENDPOINTS = {
    "overview":        "/api/overview",
    "main_categories": "/api/main-categories",
    "categories_overview": "/api/categories/overview",
    "skus":            "/api/export/skus?format=json",
}

def fetch(api: str, path: str):
    with urllib.request.urlopen(api + path, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def build_snapshot(api: str) -> dict:
    snap = {"generated_at": __import__("datetime").datetime.now().astimezone().isoformat()}
    for key, path in ENDPOINTS.items():
        try:
            snap[key] = fetch(api, path)
            print(f"  [ok] {key}: {path}", flush=True)
        except Exception as e:
            print(f"  [warn] {key} failed: {e}", flush=True)
            snap[key] = [] if key != "overview" else {}
    return snap

def encrypt(password: str, plaintext: bytes) -> bytes:
    # PBKDF2-HMAC-SHA256 (100k) -> AES-256-GCM, layout salt||iv||ct (WebCrypto-compatible)
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt = os.urandom(16)
    iv = os.urandom(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100_000)
    key = kdf.derive(password.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, plaintext, None)
    return salt + iv + ct

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:4310")
    args = ap.parse_args()

    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password:
        password = getpass.getpass("Dashboard share password (input hidden): ")
    if not password:
        print("ERROR: empty password", file=sys.stderr); return 1

    print(f"[1/3] snapshot from {args.api} ...", flush=True)
    snap = build_snapshot(args.api)
    plain = json.dumps(snap, ensure_ascii=False).encode("utf-8")
    with open(OUT_JSON, "wb") as f: f.write(plain)
    print(f"      data.json = {len(plain):,} bytes "
          f"({len(snap.get('skus', []))} SKUs)", flush=True)

    print("[2/3] encrypt -> data.json.enc ...", flush=True)
    blob = encrypt(password, plain)
    with open(OUT_ENC, "wb") as f: f.write(blob)
    print(f"      data.json.enc = {len(blob):,} bytes", flush=True)

    # never keep the plaintext snapshot lying around in the share dir
    try: os.remove(OUT_JSON)
    except OSError: pass
    print("[3/3] done. Commit ONLY index.html + data.json.enc (never data.json).", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
