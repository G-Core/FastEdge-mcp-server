# Independent implementation of the task 10 envelope (Python `cryptography`), for known-answer vectors.
import json, struct, base64
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def lp(parts):
    out = b""
    for p in parts:
        b = p.encode() if isinstance(p, str) else p
        out += struct.pack(">I", len(b)) + b
    return out
raw = lambda k: k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)

recipient_seed = bytes(range(1, 33))
sender_seed = bytes(range(101, 133))
salt = bytes((i * 7) % 256 for i in range(32))
nonce = bytes((i * 13 + 5) % 256 for i in range(12))
suite = "X25519/HKDF-SHA256/AES-256-GCM"
r = X25519PrivateKey.from_private_bytes(recipient_seed); e = X25519PrivateKey.from_private_bytes(sender_seed)
R, E = raw(r), raw(e)
z = e.exchange(r.public_key())
key = HKDF(hashes.SHA256(), 32, salt, lp(["fastedge/session-seal/v1", suite, R, E])).derive(z)
head = dict(v=1, suite=suite, recipient=b64(R), epk=b64(E), salt=b64(salt), nonce=b64(nonce),
            api_origin="https://api.preprod.world", client_id=5724274, token_id=2393790,
            created_at="2026-10-07T10:00:00.000Z", expires_at="2026-10-07T18:00:00.000Z")
aad = lp([str(head["v"]), suite, R, E, salt, nonce, head["api_origin"], str(head["client_id"]),
          str(head["token_id"]), head["created_at"], head["expires_at"]])
payload = dict(token="4242_kat-token-not-real", api_origin=head["api_origin"], client_id=head["client_id"],
               token_id=head["token_id"], created_at=head["created_at"], expires_at=head["expires_at"])
pt = json.dumps(payload, separators=(",", ":")).encode()
ct = AESGCM(key).encrypt(nonce, pt, aad)
print(json.dumps(dict(recipient_seed=b64(recipient_seed), sender_seed=b64(sender_seed),
                      payload=payload, envelope=dict(head, ct=b64(ct))), indent=2))
