// Ephemeral-session envelope (fastedge-coordinator tasks/10-ephemeral-session.md, "Envelope",
// frozen). The login container seals the approved token to the broker's in-memory X25519 key, so
// the volume only ever holds ciphertext that dies with the broker. Node stdlib only:
// X25519 + HKDF-SHA256 + AES-256-GCM.
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

export const SEAL_VERSION = 1;
export const SEAL_SUITE = "X25519/HKDF-SHA256/AES-256-GCM";
const LABEL = "fastedge/session-seal/v1";
const KEY_BYTES = 32;
const SALT_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const B64URL = /^[A-Za-z0-9_-]*$/;

/** What gets sealed. `token` is encrypted; the other fields are authenticated (AAD) and repeated inside. */
export interface SealedPayload {
  token: string;
  api_origin: string;
  client_id: number;
  token_id: number;
  created_at: string;
  expires_at: string;
}

export interface Envelope {
  v: number;
  suite: string;
  recipient: string;
  epk: string;
  salt: string;
  nonce: string;
  api_origin: string;
  client_id: number;
  token_id: number;
  created_at: string;
  expires_at: string;
  ct: string;
}

/** Strict base64url: canonical alphabet, no padding, and the exact length expected. */
export function decodeB64url(text: unknown, bytes?: number): Buffer | null {
  if (typeof text !== "string" || !B64URL.test(text)) return null;
  const buf = Buffer.from(text, "base64url");
  if (buf.toString("base64url") !== text) return null;
  if (bytes !== undefined && buf.length !== bytes) return null;
  return buf;
}

/** Length-prefixed concatenation (4-byte big-endian length per part), so fields can't run together. */
function lp(parts: (string | Buffer)[]): Buffer {
  return Buffer.concat(
    parts.flatMap((p) => {
      const b = typeof p === "string" ? Buffer.from(p, "utf8") : p;
      const len = Buffer.alloc(4);
      len.writeUInt32BE(b.length);
      return [len, b];
    }),
  );
}

const publicKeyFromRaw = (raw: Buffer) =>
  createPublicKey({ key: { kty: "OKP", crv: "X25519", x: raw.toString("base64url") }, format: "jwk" });

const rawPublic = (key: KeyObject) => Buffer.from(key.export({ format: "jwk" }).x as string, "base64url");

/**
 * Whether `recipient` is a usable X25519 public key: 32 bytes of strict base64url that gives a
 * non-zero shared secret (low-order points, including all-zero, don't). Checked before any login.
 */
export function isValidRecipient(recipient: unknown): recipient is string {
  const R = decodeB64url(recipient, KEY_BYTES);
  if (!R) return false;
  try {
    const z = diffieHellman({ privateKey: generateKeyPairSync("x25519").privateKey, publicKey: publicKeyFromRaw(R) });
    return !z.every((b) => b === 0);
  } catch {
    return false;
  }
}

/** A recipient key pair. The private key never leaves the process that created it. */
export function generateRecipient(): { privateKey: KeyObject; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return { privateKey, publicKey: rawPublic(publicKey).toString("base64url") };
}

/** Test hook: a recipient from a fixed 32-byte private scalar. */
export function recipientFromSeed(seed: Buffer): { privateKey: KeyObject; publicKey: string } {
  if (seed.length !== KEY_BYTES) throw new Error("seed must be 32 bytes");
  // PKCS#8 for an X25519 private key (RFC 8410): fixed 16-byte header, then the scalar.
  const der = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return { privateKey, publicKey: rawPublic(createPublicKey(privateKey)).toString("base64url") };
}

function sharedKey(privateKey: KeyObject, peer: Buffer, R: Buffer, E: Buffer, salt: Buffer): Buffer | null {
  let z: Buffer;
  try {
    z = diffieHellman({ privateKey, publicKey: publicKeyFromRaw(peer) });
  } catch {
    return null; // low-order or invalid point
  }
  if (z.length !== KEY_BYTES || z.every((b) => b === 0)) return null;
  const info = lp([LABEL, SEAL_SUITE, R, E]);
  return Buffer.from(hkdfSync("sha256", z, salt, info, KEY_BYTES));
}

function aad(e: Omit<Envelope, "ct">, R: Buffer, E: Buffer, salt: Buffer, nonce: Buffer): Buffer {
  return lp([
    String(e.v),
    e.suite,
    R,
    E,
    salt,
    nonce,
    e.api_origin,
    String(e.client_id),
    String(e.token_id),
    e.created_at,
    e.expires_at,
  ]);
}

/** Seals `payload` to the recipient's raw public key (base64url). A fresh sender key, salt and nonce every time. */
export const seal = (recipient: string, payload: SealedPayload): Envelope => sealWith(recipient, payload, {});

/** TESTS ONLY: seal with fixed randomness, for known-answer vectors. Never use in production. */
export const sealForTest = (
  recipient: string,
  payload: SealedPayload,
  random: { ephemeralSeed: Buffer; salt: Buffer; nonce: Buffer },
): Envelope => sealWith(recipient, payload, random);

function sealWith(
  recipient: string,
  payload: SealedPayload,
  random: { ephemeralSeed?: Buffer; salt?: Buffer; nonce?: Buffer },
): Envelope {
  const R = decodeB64url(recipient, KEY_BYTES);
  if (!R) throw new Error("invalid recipient key");
  const sender = random.ephemeralSeed ? recipientFromSeed(random.ephemeralSeed) : generateRecipient();
  const E = Buffer.from(sender.publicKey, "base64url");
  const salt = random.salt ?? randomBytes(SALT_BYTES);
  const nonce = random.nonce ?? randomBytes(NONCE_BYTES);
  const key = sharedKey(sender.privateKey, R, R, E, salt);
  if (!key) throw new Error("invalid recipient key");

  const head = {
    v: SEAL_VERSION,
    suite: SEAL_SUITE,
    recipient,
    epk: E.toString("base64url"),
    salt: salt.toString("base64url"),
    nonce: nonce.toString("base64url"),
    api_origin: payload.api_origin,
    client_id: payload.client_id,
    token_id: payload.token_id,
    created_at: payload.created_at,
    expires_at: payload.expires_at,
  };
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(head, R, E, salt, nonce));
  // Fixed field order, so the plaintext doesn't depend on how the caller built `payload`.
  const ordered = {
    token: payload.token,
    api_origin: payload.api_origin,
    client_id: payload.client_id,
    token_id: payload.token_id,
    created_at: payload.created_at,
    expires_at: payload.expires_at,
  };
  const plaintext = Buffer.from(JSON.stringify(ordered), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  plaintext.fill(0);
  return { ...head, ct: ct.toString("base64url") };
}

const ENVELOPE_KEYS = [
  "v", "suite", "recipient", "epk", "salt", "nonce",
  "api_origin", "client_id", "token_id", "created_at", "expires_at", "ct",
] as const;
const PAYLOAD_FIELDS = ["api_origin", "client_id", "token_id", "created_at", "expires_at"] as const;

/**
 * Opens an envelope with the recipient's private key. Null on any problem (wrong recipient,
 * tampering, malformed fields): one generic failure, nothing parsed before the tag verifies.
 */
export function open(privateKey: KeyObject, recipient: string, raw: unknown): SealedPayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (Object.keys(e).length !== ENVELOPE_KEYS.length || !ENVELOPE_KEYS.every((k) => k in e)) return null;
  if (e.v !== SEAL_VERSION || e.suite !== SEAL_SUITE || e.recipient !== recipient) return null;
  if (typeof e.api_origin !== "string" || typeof e.created_at !== "string" || typeof e.expires_at !== "string") return null;
  if (!Number.isSafeInteger(e.client_id) || !Number.isSafeInteger(e.token_id)) return null;

  const R = decodeB64url(recipient, KEY_BYTES);
  const E = decodeB64url(e.epk, KEY_BYTES);
  const salt = decodeB64url(e.salt, SALT_BYTES);
  const nonce = decodeB64url(e.nonce, NONCE_BYTES);
  const ct = decodeB64url(e.ct);
  if (!R || !E || !salt || !nonce || !ct || ct.length <= TAG_BYTES) return null;

  const key = sharedKey(privateKey, E, R, E, salt);
  if (!key) return null;
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(e as unknown as Envelope, R, E, salt, nonce));
    decipher.setAuthTag(ct.subarray(ct.length - TAG_BYTES));
    plaintext = Buffer.concat([decipher.update(ct.subarray(0, ct.length - TAG_BYTES)), decipher.final()]);
  } catch {
    return null;
  }
  try {
    const p = JSON.parse(plaintext.toString("utf8"));
    if (typeof p?.token !== "string") return null;
    // The authenticated outer fields must match the encrypted ones.
    if (!PAYLOAD_FIELDS.every((k) => p[k] === e[k])) return null;
    return {
      token: p.token,
      api_origin: p.api_origin,
      client_id: p.client_id,
      token_id: p.token_id,
      created_at: p.created_at,
      expires_at: p.expires_at,
    };
  } catch {
    return null;
  } finally {
    plaintext.fill(0);
  }
}
