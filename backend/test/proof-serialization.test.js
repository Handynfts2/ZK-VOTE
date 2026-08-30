import test from "node:test";
import assert from "node:assert/strict";
import {
  serializeProof,
  deserializeProof,
  serializeProofToHex,
  deserializeProofFromHex,
  ProofCurveId,
  ProofFormatError,
  PROOF_FORMAT_VERSION,
  SERIALIZED_PROOF_LEN,
} from "../src/services/proofSerialization.js";

function samplePotProof(seed) {
  const hexOf = (len, offset) => {
    let s = "";
    for (let i = 0; i < len; i++) {
      s += ((seed + offset + i) % 256).toString(16).padStart(2, "0");
    }
    return s;
  };
  return {
    a: "0x" + hexOf(64, 1),
    b: "0x" + hexOf(128, 2),
    c: "0x" + hexOf(64, 3),
  };
}

test("ZKV1: round trip preserves the proof exactly (BN254)", () => {
  const proof = samplePotProof(11);
  const bytes = serializeProof(proof, ProofCurveId.Bn254);

  assert.equal(bytes.length, SERIALIZED_PROOF_LEN);
  assert.equal(bytes[0], PROOF_FORMAT_VERSION);
  assert.equal(bytes[1], ProofCurveId.Bn254);

  const { proof: decoded, curve } = deserializeProof(bytes);
  assert.equal(curve, ProofCurveId.Bn254);
  assert.equal(decoded.a, proof.a);
  assert.equal(decoded.b, proof.b);
  assert.equal(decoded.c, proof.c);
});

test("ZKV1: round trip preserves the proof exactly (BLS12-381 curve id)", () => {
  const proof = samplePotProof(99);
  const bytes = serializeProof(proof, ProofCurveId.Bls12381);
  assert.equal(bytes[1], ProofCurveId.Bls12381);

  const { proof: decoded, curve } = deserializeProof(bytes);
  assert.equal(curve, ProofCurveId.Bls12381);
  assert.equal(decoded.a, proof.a);
  assert.equal(decoded.c, proof.c);
});

test("ZKV1: hex round trip helpers agree with buffer round trip", () => {
  const proof = samplePotProof(5);
  const hex = serializeProofToHex(proof);
  const { proof: decoded } = deserializeProofFromHex(hex);
  assert.equal(decoded.a, proof.a);
  assert.equal(decoded.b, proof.b);
  assert.equal(decoded.c, proof.c);
});

test("ZKV1: rejects an unknown version byte", () => {
  const proof = samplePotProof(1);
  const bytes = serializeProof(proof);
  bytes[0] = PROOF_FORMAT_VERSION + 1;
  assert.throws(() => deserializeProof(bytes), ProofFormatError);
});

test("ZKV1: rejects an unknown curve id byte", () => {
  const proof = samplePotProof(1);
  const bytes = serializeProof(proof);
  bytes[1] = 0xff;
  assert.throws(() => deserializeProof(bytes), ProofFormatError);
});

test("ZKV1: rejects buffers of the wrong length", () => {
  const proof = samplePotProof(1);
  const bytes = serializeProof(proof);
  assert.throws(() => deserializeProof(bytes.subarray(0, bytes.length - 1)), ProofFormatError);
  assert.throws(
    () => deserializeProof(Buffer.concat([bytes, Buffer.from([0])])),
    ProofFormatError,
  );
});

test("ZKV1: rejects the point-at-infinity proof (all-zero component)", () => {
  const zeroProof = {
    a: "0x" + "00".repeat(64),
    b: "0x" + "11".repeat(128),
    c: "0x" + "22".repeat(64),
  };
  assert.throws(() => serializeProof(zeroProof), ProofFormatError);
});

test("ZKV1: distinct proofs serialize to distinct byte strings", () => {
  const p1 = samplePotProof(1);
  const p2 = samplePotProof(2);
  const b1 = serializeProof(p1);
  const b2 = serializeProof(p2);
  assert.notEqual(b1.toString("hex"), b2.toString("hex"));
});

test("ZKV1: example proof vector is stable and round-trips (interop fixture)", () => {
  // Fixed example vector for cross-implementation interoperability testing
  // (matches the vector documented in docs/zk-voting-protocol.md).
  const proof = {
    a: "0x" + "01".repeat(64),
    b: "0x" + "02".repeat(128),
    c: "0x" + "03".repeat(64),
  };
  const hex = serializeProofToHex(proof, ProofCurveId.Bn254);
  assert.equal(
    hex,
    "0x0100" + "01".repeat(64) + "02".repeat(128) + "03".repeat(64),
  );
  const { proof: decoded, curve } = deserializeProofFromHex(hex);
  assert.equal(curve, ProofCurveId.Bn254);
  assert.deepEqual(decoded, proof);
});
