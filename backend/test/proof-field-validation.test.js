/**
 * Groth16 proof coordinate field-range validation (#167)
 *
 * proof.a/b/c were previously only checked for all-zeros. This adds a check
 * that every G1/G2 coordinate is a valid BN254 base-field (Fq) element —
 * catching malformed proof coordinates before they reach the relayer/chain.
 * Full curve/subgroup membership verification remains the Soroban host's
 * job at proof-verification time.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import { groth16Proof } from "../src/validation/schemas.js";

const FQ_HEX = "30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47";

function repeatHex(byte, hexChars) {
  return byte.repeat(hexChars / 2);
}

describe("groth16Proof field-range validation", () => {
  it("accepts a proof whose coordinates are all below the Fq modulus", () => {
    const proof = {
      a: repeatHex("11", 128),
      b: repeatHex("22", 256),
      c: repeatHex("05", 128),
    };
    const result = groth16Proof.safeParse(proof);
    assert.ok(result.success, JSON.stringify(result.error?.issues));
  });

  it("rejects proof.a when its Y-coordinate is >= the Fq modulus", () => {
    // First coordinate (X) valid, second coordinate (Y) is exactly the
    // Fq modulus itself — out of range.
    const proof = {
      a: "11".repeat(64) + FQ_HEX,
      b: repeatHex("22", 256),
      c: repeatHex("05", 128),
    };
    const result = groth16Proof.safeParse(proof);
    assert.strictEqual(result.success, false);
  });

  it("rejects proof.c when a coordinate exceeds the Fq modulus", () => {
    // '33' repeated is > Fq (Fq starts with '3064...', '3333...' is larger).
    const proof = {
      a: repeatHex("11", 128),
      b: repeatHex("22", 256),
      c: repeatHex("33", 128),
    };
    const result = groth16Proof.safeParse(proof);
    assert.strictEqual(result.success, false);
  });

  it("still rejects the all-zeros point at infinity", () => {
    const proof = {
      a: "0".repeat(128),
      b: "0".repeat(256),
      c: "0".repeat(128),
    };
    const result = groth16Proof.safeParse(proof);
    assert.strictEqual(result.success, false);
  });
});
