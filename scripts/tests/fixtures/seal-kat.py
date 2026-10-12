#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["cryptography"]
# ///
"""Known-answer vector for the session-seal envelope, from an independent implementation.

Regenerates seal-kat.json, which test-seal.ts checks src/auth/seal.ts against byte for byte:

    uv run scripts/tests/fixtures/seal-kat.py > scripts/tests/fixtures/seal-kat.json
"""
import base64
import json
import struct

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SUITE = "X25519/HKDF-SHA256/AES-256-GCM"
LABEL = "fastedge/session-seal/v1"


def b64(data: bytes) -> str:
    """Unpadded base64url, as the envelope uses."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def lp(parts) -> bytes:
    """Length-prefixed concatenation: a 4-byte big-endian length before each part."""
    out = b""
    for part in parts:
        data = part.encode() if isinstance(part, str) else part
        out += struct.pack(">I", len(data)) + data
    return out


def raw_public(key: X25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def main() -> None:
    recipient_seed = bytes(range(1, 33))
    sender_seed = bytes(range(101, 133))
    salt = bytes((i * 7) % 256 for i in range(32))
    nonce = bytes((i * 13 + 5) % 256 for i in range(12))

    recipient = X25519PrivateKey.from_private_bytes(recipient_seed)
    sender = X25519PrivateKey.from_private_bytes(sender_seed)
    r_pub, e_pub = raw_public(recipient), raw_public(sender)
    shared = sender.exchange(recipient.public_key())
    key = HKDF(hashes.SHA256(), 32, salt, lp([LABEL, SUITE, r_pub, e_pub])).derive(shared)

    head = dict(v=1, suite=SUITE, recipient=b64(r_pub), epk=b64(e_pub), salt=b64(salt), nonce=b64(nonce),
                api_origin="https://api.preprod.world", client_id=5724274, token_id=2393790,
                created_at="2026-10-07T10:00:00.000Z", expires_at="2026-10-07T18:00:00.000Z")
    aad = lp([str(head["v"]), SUITE, r_pub, e_pub, salt, nonce, head["api_origin"], str(head["client_id"]),
              str(head["token_id"]), head["created_at"], head["expires_at"]])
    payload = dict(token="4242_kat-token-not-real", api_origin=head["api_origin"], client_id=head["client_id"],
                   token_id=head["token_id"], created_at=head["created_at"], expires_at=head["expires_at"])
    ciphertext = AESGCM(key).encrypt(nonce, json.dumps(payload, separators=(",", ":")).encode(), aad)

    print(json.dumps(dict(recipient_seed=b64(recipient_seed), sender_seed=b64(sender_seed),
                          payload=payload, envelope=dict(head, ct=b64(ciphertext))), indent=2))


if __name__ == "__main__":
    main()
