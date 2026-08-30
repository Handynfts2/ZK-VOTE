/**
 * Groth16 Proof Canonicalization Tests (#167)
 *
 * Groth16 proofs are malleable: (A, B, C) and (-A, -B, C) both verify.
 * canonicalizeProof() picks a single representative (A's Y-coordinate in
 * the lower half of the BN254 base field Fq) so the two forms of the same
 * proof always encode identically before reaching storage or on-chain
 * submission.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import { canonicalizeProof } from "../src/services/stellar.js";
import { BN254_FQ_MODULUS } from "../src/types/index.js";

function bigIntToBytes(n, length) {
  return Buffer.from(n.toString(16).padStart(length * 2, "0"), "hex");
}

const FQ_HALF = (BN254_FQ_MODULUS - 1n) / 2n;

// An arbitrary X (canonicalization never touches X) and a Y strictly in the
// lower half of Fq (already canonical).
const AX = 0x1234n;
const LOW_Y = 5n;
const HIGH_Y = BN254_FQ_MODULUS - 5n; // > FQ_HALF, needs negation

function buildA(y) {
  return Buffer.concat([bigIntToBytes(AX, 32), bigIntToBytes(y, 32)]);
}

function buildB(yc1, yc0) {
  return Buffer.concat([
    bigIntToBytes(0xaaaan, 32), // X_c1 (untouched)
    bigIntToBytes(0xbbbbn, 32), // X_c0 (untouched)
    bigIntToBytes(yc1, 32),
    bigIntToBytes(yc0, 32),
  ]);
}

describe("canonicalizeProof", () => {
  it("leaves an already-canonical proof (Y in lower half) unchanged", () => {
    const a = buildA(LOW_Y);
    const b = buildB(7n, 9n);

    const result = canonicalizeProof(a, b);

    assert.strictEqual(result.a.toString("hex"), a.toString("hex"));
    assert.strictEqual(result.b.toString("hex"), b.toString("hex"));
  });

  it("negates A.Y and both B.Y components when A.Y is in the upper half", () => {
    const yc1 = 7n;
    const yc0 = 9n;
    const a = buildA(HIGH_Y);
    const b = buildB(yc1, yc0);

    const result = canonicalizeProof(a, b);

    const resultAy = BigInt("0x" + result.a.subarray(32, 64).toString("hex"));
    const resultAx = BigInt("0x" + result.a.subarray(0, 32).toString("hex"));
    assert.strictEqual(resultAx, AX, "X must be untouched");
    assert.strictEqual(resultAy, BN254_FQ_MODULUS - HIGH_Y);
    assert.ok(resultAy <= FQ_HALF, "negated Y must land in the lower half");

    const resultXc1 = result.b.subarray(0, 32).toString("hex");
    const resultXc0 = result.b.subarray(32, 64).toString("hex");
    assert.strictEqual(resultXc1, b.subarray(0, 32).toString("hex"), "B.X_c1 must be untouched");
    assert.strictEqual(resultXc0, b.subarray(32, 64).toString("hex"), "B.X_c0 must be untouched");

    const resultYc1 = BigInt("0x" + result.b.subarray(64, 96).toString("hex"));
    const resultYc0 = BigInt("0x" + result.b.subarray(96, 128).toString("hex"));
    assert.strictEqual(resultYc1, BN254_FQ_MODULUS - yc1);
    assert.strictEqual(resultYc0, BN254_FQ_MODULUS - yc0);
  });

  it("canonicalizes both malleable representations of the same proof to an identical result", () => {
    // (A, B) and (-A, -B) are the two malleable forms of the same proof.
    const a1 = buildA(HIGH_Y);
    const b1 = buildB(7n, 9n);

    const negA = BN254_FQ_MODULUS - HIGH_Y;
    const a2 = buildA(negA);
    const b2 = buildB(BN254_FQ_MODULUS - 7n, BN254_FQ_MODULUS - 9n);

    const canon1 = canonicalizeProof(a1, b1);
    const canon2 = canonicalizeProof(a2, b2);

    assert.strictEqual(canon1.a.toString("hex"), canon2.a.toString("hex"));
    assert.strictEqual(canon1.b.toString("hex"), canon2.b.toString("hex"));
  });
});
