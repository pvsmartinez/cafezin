#!/usr/bin/env python3
"""
Signs a file using the Tauri/rsign/minisign format (Ed25519 + Scrypt).
Compatible with tauri-plugin-updater signature verification.

Usage: python3 sign-updater.py <file> [password]
Reads key from ~/.tauri/cafezin.key (base64-wrapped minisign format).
"""

import base64, hashlib, struct, sys, os
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption

def load_and_sign(key_path: str, file_path: str, password: str = "") -> str:
    """Returns the .sig file content (string) as Tauri expects."""

    # ── Decode the key file (outer base64 → minisign text → inner base64 → bytes) ──
    raw_outer = Path(key_path).read_text().strip()
    inner_text = base64.b64decode(raw_outer).decode("utf-8")
    lines = [l for l in inner_text.split("\n") if l.strip()]
    # line[0] = "untrusted comment: rsign encrypted secret key"
    # line[1] = base64 of the actual key binary
    key_data = base64.b64decode(lines[1])

    # ── Parse key fields (rsign2 format: salt BEFORE opslimit/memlimit) ──
    sig_algo   = key_data[0:2]    # "Ed"
    kdf_algo   = key_data[2:4]    # "Sc" = Scrypt
    cksum_algo = key_data[4:6]    # "B2" = Blake2b
    kdf_salt   = key_data[6:38]   # 32 bytes  ← FIRST in rsign2
    opslimit   = struct.unpack("<Q", key_data[38:46])[0]  # LE u64
    memlimit   = struct.unpack("<Q", key_data[46:54])[0]  # LE u64
    keynum_sk  = key_data[54:158] # 104 bytes (encrypted)

    # ── Derive stream via Scrypt and XOR-decrypt keynum_sk ──
    # rsign2: N = opslimit / 64, r=8, p=1, dklen=104
    n = int(opslimit) // 64
    if n == 0 or (n & (n - 1)) != 0:
        # Fallback: try standard minisign N derivation
        n = 1 << (int(opslimit) - 1).bit_length()
    stream = hashlib.scrypt(password.encode("utf-8"), salt=kdf_salt, n=n, r=8, p=1, dklen=104)
    decrypted = bytes(a ^ b for a, b in zip(keynum_sk, stream))

    # ── Extract fields from decrypted keynum_sk ──
    # rsign2 / minisign format: keynum(8) + sk_seed(32) + pk(32) + cksum(32)
    keynum  = decrypted[0:8]
    sk_seed = decrypted[8:40]   # Ed25519 seed (32 bytes)
    pk      = decrypted[40:72]  # Ed25519 public key (32 bytes)
    cksum   = decrypted[72:104] # Blake2b checksum (32 bytes)

    # ── Verify checksum ──
    # rsign2 format: blake2b(sig_algo + keynum + sk_seed + pk, digest_size=32)
    expected_cksum = hashlib.blake2b(
        sig_algo + keynum + sk_seed + pk, digest_size=32
    ).digest()
    if cksum != expected_cksum:
        print(f"ERROR: Wrong password — checksum mismatch.", file=sys.stderr)
        print(f"  opslimit={opslimit}, n={n}", file=sys.stderr)
        print(f"  Expected cksum: {expected_cksum.hex()}", file=sys.stderr)
        print(f"  Got cksum:      {cksum.hex()}", file=sys.stderr)
        sys.exit(1)

    print("✓ Key decrypted successfully")

    # ── Sign the file ──
    private_key = Ed25519PrivateKey.from_private_bytes(sk_seed)
    content = Path(file_path).read_bytes()
    signature = private_key.sign(content)

    # ── Build the .sig file in rsign/minisign format ──
    # sig_data = sig_algorithm (2B) + keynum (8B) + signature (64B) = 74 bytes
    sig_data = sig_algo + keynum + signature
    sig_b64  = base64.b64encode(sig_data).decode("ascii")

    keynum_hex = keynum.hex().upper()
    filename   = Path(file_path).name

    sig_content = (
        f"untrusted comment: signature from rsign secret key: {keynum_hex}\n"
        f"{sig_b64}\n"
        f"trusted comment: timestamp:0\tfile:{filename}\n"
        f"\n"
    )

    return sig_content


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <file_to_sign> [password]")
        sys.exit(1)

    file_to_sign = sys.argv[1]
    password     = sys.argv[2] if len(sys.argv) > 2 else ""

    key_path = os.path.expanduser("~/.tauri/cafezin.key")

    if not Path(key_path).exists():
        print(f"ERROR: Key not found at {key_path}", file=sys.stderr)
        sys.exit(1)

    if not Path(file_to_sign).exists():
        print(f"ERROR: File not found: {file_to_sign}", file=sys.stderr)
        sys.exit(1)

    sig_content = load_and_sign(key_path, file_to_sign, password)

    sig_path = file_to_sign + ".sig"
    Path(sig_path).write_text(sig_content)
    print(f"✓ Signature written to {sig_path}")
