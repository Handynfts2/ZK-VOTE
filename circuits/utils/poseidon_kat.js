#!/usr/bin/env node
/**
 * Poseidon Known Answer Test (KAT)
 *
 * Verifies compatibility between:
 * 1. circomlibjs (used for generating proofs)
 * 2. Stellar P25 host Poseidon (used on-chain)
 *
 * Tests:
 * - Zero leaf handling (must both use 0)
 * - Hash parity for 1-input, 2-input, 3-input Poseidon
 * - Merkle tree hash computation
 */

const { buildPoseidon } = require("circomlibjs");

// Test vectors for Poseidon hash
const TEST_VECTORS = [
  {
    name: "Zero leaf",
    inputs: [0],
    expected: null, // Will compute from circomlibjs
  },
  {
    name: "Single input (secret=1)",
    inputs: [1],
    expected: null,
  },
  {
    name: "Two inputs (secret=1, salt=2)",
    inputs: [1, 2],
    expected: null,
  },
  {
    name: "Two inputs (left=0, right=0) - empty node",
    inputs: [0, 0],
    expected: null,
  },
  {
    name: "Three inputs (secret=1, daoId=1, proposalId=42) - nullifier",
    inputs: [1, 1, 42],
    expected: null,
  },
  {
    name: "Large values",
    inputs: [
      BigInt("12345678901234567890"),
      BigInt("98765432109876543210")
    ],
    expected: null,
  },
];

async function main() {
  console.log("=== Poseidon Known Answer Test ===\n");

  // Build Poseidon instance (circomlibjs uses same params as circomlib)
  const poseidon = await buildPoseidon();

  console.log("Circomlib Poseidon Parameters:");
  console.log("- Field: BN254 scalar field (Fr)");
  console.log("- S-box: x^5");
  console.log("- Full rounds: 8");
  console.log("- Partial rounds (t=2): 56, (t=3): 57, (t=4): 56");
  console.log("");

  // Run test vectors
  console.log("=== Test Vectors ===\n");

  for (const test of TEST_VECTORS) {
    const hash = poseidon(test.inputs);
    const hashStr = poseidon.F.toString(hash);

    console.log(`${test.name}:`);
    console.log(`  Inputs:  [${test.inputs.join(", ")}]`);
    console.log(`  Hash:    ${hashStr}`);
    console.log("");
  }

  // Special case: raw 2-input Poseidon parity (unaffected by #167 — this is
  // the underlying hash_pair primitive both circomlib and the Stellar host
  // must agree on, independent of how the tree uses it).
  console.log("=== Raw Poseidon(2) Zero Chain (parameter parity only) ===\n");
  console.log("Computing raw[0..5] where raw[i+1] = Poseidon(raw[i], raw[i]), raw[0] = 0:\n");

  let zero = poseidon.F.zero;
  console.log(`raw[0] = ${poseidon.F.toString(zero)}`);

  for (let i = 0; i < 5; i++) {
    zero = poseidon([zero, zero]);
    console.log(`raw[${i+1}] = ${poseidon.F.toString(zero)}`);
  }

  // #167: the tree itself no longer uses raw[0] (= 0) as its empty-leaf
  // value. Every leaf — including the empty/zero leaf — is domain-tagged
  // as Poseidon(LEAF_DOMAIN, leaf) before entering the tree, so a raw
  // commitment (or a forged internal-node hash) can never be inserted
  // directly as a tree value. LEAF_DOMAIN must match across
  // merkle_tree.circom, frontend/src/lib/merkletree.ts, and
  // contracts/membership-tree/src/lib.rs.
  console.log("\n=== Merkle Tree Zero Values (domain-separated, #167) ===\n");
  console.log("zeros[0] = Poseidon(LEAF_DOMAIN, 0); zeros[i+1] = Poseidon(zeros[i], zeros[i]):\n");

  const LEAF_DOMAIN = 1n;
  let domainZero = poseidon([LEAF_DOMAIN, 0n]);
  console.log(`zeros[0] = ${poseidon.F.toString(domainZero)}`);

  for (let i = 0; i < 5; i++) {
    domainZero = poseidon([domainZero, domainZero]);
    console.log(`zeros[${i+1}] = ${poseidon.F.toString(domainZero)}`);
  }

  console.log("\n=== Instructions for On-Chain Verification ===\n");
  console.log("1. Deploy the membership-tree contract to your test network");
  console.log("2. Call tree contract functions to verify Poseidon parity:");
  console.log("");
  console.log("Test zero leaf:");
  console.log("  stellar contract invoke --id <TREE_CONTRACT> -- test_hash --a 0 --b 0");
  console.log("");
  console.log("Test commitment (secret=1, salt=2):");
  console.log("  stellar contract invoke --id <TREE_CONTRACT> -- test_hash --a 1 --b 2");
  console.log("");
  console.log("Compare outputs with the hashes above.");
  console.log("If they match, Poseidon parameters are compatible! ✓");
  console.log("");
  console.log("=== Stellar P25 Poseidon Notes ===\n");
  console.log("According to P25 documentation:");
  console.log("- Uses BN254 scalar field (Fr)");
  console.log("- Should match circomlib implementation");
  console.log("- Verify via env.crypto().poseidon_hash() host function");
  console.log("");
  console.log("IMPORTANT: If hashes DON'T match, check:");
  console.log("1. Are we using the same Poseidon variant? (original vs Poseidon2)");
  console.log("2. Are round constants identical?");
  console.log("3. Is the MDS matrix the same?");
  console.log("4. Is input ordering consistent?");
}

main().catch(console.error);
