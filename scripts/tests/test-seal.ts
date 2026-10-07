// Ephemeral-session envelope (src/auth/seal.ts). The known-answer vector comes from an independent
// implementation (fixtures/seal-kat.py, Python `cryptography`), not from a round trip.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { decodeB64url, generateRecipient, open, recipientFromSeed, seal } from "../../src/auth/seal.js";

const kat = JSON.parse(fs.readFileSync(new URL("./fixtures/seal-kat.json", import.meta.url), "utf8"));
const recipient = recipientFromSeed(Buffer.from(kat.recipient_seed, "base64url"));

test("KAT: the recipient public key matches the independent implementation", () => {
  assert.equal(recipient.publicKey, kat.envelope.recipient);
});

test("KAT: seal with the vector's randomness reproduces the envelope byte for byte", () => {
  const env = seal(kat.envelope.recipient, kat.payload, {
    ephemeralSeed: Buffer.from(kat.sender_seed, "base64url"),
    salt: Buffer.from(kat.envelope.salt, "base64url"),
    nonce: Buffer.from(kat.envelope.nonce, "base64url"),
  });
  assert.deepEqual(env, kat.envelope);
});

test("KAT: open() decrypts the independently produced envelope", () => {
  assert.deepEqual(open(recipient.privateKey, recipient.publicKey, kat.envelope), kat.payload);
});

test("a fresh sender key, salt and nonce every time", () => {
  const a = seal(kat.envelope.recipient, kat.payload);
  const b = seal(kat.envelope.recipient, kat.payload);
  assert.notEqual(a.epk, b.epk);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.ct, b.ct);
  assert.ok(!JSON.stringify(a).includes(kat.payload.token), "the token never appears in the envelope");
});

test("tampering with any authenticated field fails", () => {
  const changes: Record<string, unknown> = {
    api_origin: "https://api.gcore.com",
    client_id: kat.envelope.client_id + 1,
    token_id: kat.envelope.token_id + 1,
    created_at: "2026-10-07T09:00:00.000Z",
    expires_at: "2026-10-08T18:00:00.000Z",
    salt: Buffer.alloc(32, 9).toString("base64url"),
    nonce: Buffer.alloc(12, 9).toString("base64url"),
    epk: generateRecipient().publicKey,
  };
  for (const [field, value] of Object.entries(changes)) {
    assert.equal(open(recipient.privateKey, recipient.publicKey, { ...kat.envelope, [field]: value }), null, field);
  }
});

test("a flipped ciphertext bit or a truncated tag fails", () => {
  const ct = Buffer.from(kat.envelope.ct, "base64url");
  const flipped = Buffer.from(ct);
  flipped[0] ^= 1;
  assert.equal(open(recipient.privateKey, recipient.publicKey, { ...kat.envelope, ct: flipped.toString("base64url") }), null);
  const truncated = ct.subarray(0, ct.length - 1).toString("base64url");
  assert.equal(open(recipient.privateKey, recipient.publicKey, { ...kat.envelope, ct: truncated }), null);
  const tagOnly = ct.subarray(ct.length - 16).toString("base64url");
  assert.equal(open(recipient.privateKey, recipient.publicKey, { ...kat.envelope, ct: tagOnly }), null);
});

test("the wrong recipient can't open it", () => {
  const other = generateRecipient();
  assert.equal(open(other.privateKey, other.publicKey, kat.envelope), null);
  // Even when told the envelope's recipient: the private key doesn't match.
  assert.equal(open(other.privateKey, kat.envelope.recipient, kat.envelope), null);
});

test("an encrypted payload that disagrees with the outer fields fails", () => {
  // Sealed with client 1 inside but relabelled outside: the AAD catches it before parsing.
  const env = seal(recipient.publicKey, { ...kat.payload, client_id: 1 });
  assert.equal(open(recipient.privateKey, recipient.publicKey, { ...env, client_id: kat.payload.client_id }), null);
});

test("low-order and all-zero sender keys are refused", () => {
  const lowOrder = [
    Buffer.alloc(32), // 0
    Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]), // 1
    Buffer.from("e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800", "hex"), // order 8
  ];
  for (const point of lowOrder) {
    assert.equal(
      open(recipient.privateKey, recipient.publicKey, { ...kat.envelope, epk: point.toString("base64url") }),
      null,
    );
    assert.throws(() => seal(point.toString("base64url"), kat.payload));
  }
});

test("malformed input is refused", () => {
  assert.equal(decodeB64url("AQ=="), null, "padding");
  assert.equal(decodeB64url("AQ+/"), null, "standard alphabet");
  assert.equal(decodeB64url("AR"), null, "non-canonical trailing bits");
  assert.equal(decodeB64url("AQ", 2), null, "wrong length");
  assert.throws(() => seal("not-a-key", kat.payload));
  const bad = (env: unknown) => open(recipient.privateKey, recipient.publicKey, env);
  assert.equal(bad(null), null);
  assert.equal(bad([]), null);
  assert.equal(bad({ ...kat.envelope, extra: 1 }), null, "unexpected field");
  assert.equal(bad({ ...kat.envelope, v: 2 }), null, "version");
  assert.equal(bad({ ...kat.envelope, suite: "other" }), null, "suite");
  assert.equal(bad({ ...kat.envelope, client_id: "5724274" }), null, "type");
  assert.equal(bad({ ...kat.envelope, ct: kat.envelope.ct + "=" }), null, "ct encoding");
});
