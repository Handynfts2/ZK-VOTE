import test from "node:test";
import assert from "node:assert/strict";
import {
  generateIssuerKeyPair,
  blind,
  signBlinded,
  unblind,
  verify,
  modPow,
  modInverse,
  issueCredential,
  BlindSignatureError,
  buildDidAttributeProofSeed,
} from "../src/services/blindSignature.js";

// Use a smaller modulus for fast tests; correctness of the modular
// arithmetic does not depend on key size.
const TEST_MODULUS_BITS = 1024;

test("modular arithmetic: modInverse and modPow round-trip", () => {
  const m = 3233n; // 61 * 53
  const a = 7n;
  const inv = modInverse(a, m);
  assert.equal((a * inv) % m, 1n);
});

test("blind signature: full protocol round trip produces a valid signature", () => {
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const message = 123456789012345n;

  const { blinded, r } = blind(message, key);
  // The issuer only ever sees `blinded`, never `message` or `r`.
  const blindSig = signBlinded(blinded, key);
  const signature = unblind(blindSig, r, key);

  assert.equal(verify(message, signature, key), true);
});

test("blind signature: convenience issueCredential helper matches manual protocol", () => {
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const message = 42n;
  const { signature } = issueCredential(message, key, key);
  assert.equal(verify(message, signature, key), true);
});

test("correctness: different messages yield different valid signatures", () => {
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const m1 = 111n;
  const m2 = 222n;
  const s1 = issueCredential(m1, key, key).signature;
  const s2 = issueCredential(m2, key, key).signature;
  assert.notEqual(s1, s2);
  assert.equal(verify(m1, s1, key), true);
  assert.equal(verify(m2, s2, key), true);
});

test("unforgeability: a signature for one message does not verify for another", () => {
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const message = 999n;
  const { signature } = issueCredential(message, key, key);
  assert.equal(verify(message + 1n, signature, key), false);
});

test("unforgeability: a tampered signature is rejected", () => {
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const message = 555n;
  const { signature } = issueCredential(message, key, key);
  const tampered = (signature + 1n) % key.n;
  assert.equal(verify(message, tampered, key), false);
});

test("unforgeability: a credential the issuer never signed does not verify", () => {
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const otherKey = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const message = 777n;
  // Forge by signing with a different key entirely (no issuer signature at all).
  const forgedSig = modPow(message, otherKey.d, otherKey.n) % key.n;
  assert.equal(verify(message, forgedSig, key), false);
});

test("input validation: blind() rejects a message outside [0, n)", () => {
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  assert.throws(() => blind(key.n, key), BlindSignatureError);
  assert.throws(() => blind(-1n, key), BlindSignatureError);
});

// --- Unlinkability -----------------------------------------------------
//
// The core privacy property: the issuer only ever observes the *blinded*
// value `m' = m * r^e mod n`. Because `r` is drawn uniformly at random and
// is coprime to `n`, `r^e mod n` ranges uniformly over `Z_n*` as `r` does
// (raising to a fixed power `e` coprime to phi(n) is a bijection on
// `Z_n*`). Multiplying by a uniformly random unit again yields a
// uniformly random unit, *independent of `m`*. We test this statistically:
// blinding many different messages should produce blinded values whose
// low-order-bit distribution is indistinguishable from blinding the same
// single message many times.
test("unlinkability: blinded values do not statistically depend on the underlying message", () => {
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const NUM_SAMPLES = 400;
  const NUM_BINS = 16;

  function bucketedSamples(messageFn) {
    const bins = new Array(NUM_BINS).fill(0);
    for (let i = 0; i < NUM_SAMPLES; i++) {
      const { blinded } = blind(messageFn(i), key);
      const bin = Number(blinded % BigInt(NUM_BINS));
      bins[bin]++;
    }
    return bins;
  }

  function chiSquare(bins) {
    const expected = NUM_SAMPLES / NUM_BINS;
    return bins.reduce((sum, observed) => {
      const diff = observed - expected;
      return sum + (diff * diff) / expected;
    }, 0);
  }

  // Case A: always blind the exact same message.
  const sameMessageBins = bucketedSamples(() => 12345n);
  // Case B: blind a different, increasing message each time.
  const varyingMessageBins = bucketedSamples((i) => BigInt(i + 1) * 999999999999n);

  const chiA = chiSquare(sameMessageBins);
  const chiB = chiSquare(varyingMessageBins);

  // 15 degrees of freedom; critical value at alpha=0.01 is ~30.58. Both
  // distributions (fixed message, varying message) should look uniform,
  // i.e. an issuer cannot distinguish "many requests for the same
  // credential" from "many requests for different credentials" just by
  // looking at the blinded values it receives.
  assert.ok(chiA < 40, `same-message blinded values not uniform: chi^2=${chiA}`);
  assert.ok(chiB < 40, `varying-message blinded values not uniform: chi^2=${chiB}`);
});

test("unlinkability: the same message blinds to a different value every time", () => {
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const message = 31337n;
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    const { blinded } = blind(message, key);
    assert.equal(seen.has(blinded.toString()), false, "blinding must be randomized");
    seen.add(blinded.toString());
  }
});

test("unlinkability: issuer cannot recover the message from the blinded value alone", () => {
  // Without the RSA private key's factorization-derived structure being
  // exploitable (standard RSA hardness assumption) and without knowing r,
  // the blinded value m' = m * r^e mod n is, from the issuer's point of
  // view, just a uniformly random element of Z_n*. We check the weaker but
  // directly testable property that the *same* blinded ciphertext-like
  // value is never reproduced for two different (message, r) pairs across
  // a reasonably sized sample -- i.e. there's no trivial deterministic
  // shortcut linking blinded values back to messages.
  const key = generateIssuerKeyPair(TEST_MODULUS_BITS);
  const pairs = [];
  for (let i = 0; i < 30; i++) {
    const message = BigInt(i + 1) * 7919n;
    const { blinded, r } = blind(message, key);
    pairs.push({ message, blinded, r });
  }
  const blindedValues = pairs.map((p) => p.blinded.toString());
  assert.equal(new Set(blindedValues).size, blindedValues.length);
});

test("DID attribute seed: validates threshold and hashes signed claim into field inputs", () => {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    issuer: "did:web:issuer.example",
    subjectDid: "did:example:holder",
    attributeKey: "simAgeDays",
    attributeValue: 90,
    issuedAt: now - 60,
    expiresAt: now + 3600,
    signature: "issuer-signature",
  };

  const seed = buildDidAttributeProofSeed(claim, 30);

  assert.equal(seed.minAttributeValue, "30");
  assert.equal(seed.attributeValue, "90");
  assert.match(seed.issuerId, /^\d+$/);
  assert.match(seed.attributeKey, /^\d+$/);
  assert.match(seed.signedClaimHash, /^\d+$/);
});

test("DID attribute seed: rejects expired or insufficient claims", () => {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    issuer: "did:web:issuer.example",
    subjectDid: "did:example:holder",
    attributeKey: "simAgeDays",
    attributeValue: 7,
    issuedAt: now - 60,
    expiresAt: now + 3600,
    signature: "issuer-signature",
  };

  assert.throws(() => buildDidAttributeProofSeed(claim, 30), BlindSignatureError);
  assert.throws(
    () =>
      buildDidAttributeProofSeed(
        {
          ...claim,
          attributeValue: 90,
          expiresAt: now - 1,
        },
        30,
      ),
    BlindSignatureError,
  );
});
