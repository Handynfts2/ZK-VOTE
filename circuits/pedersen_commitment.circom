pragma circom 2.0.0;

include "node_modules/circomlib/circuits/pedersen.circom";
include "node_modules/circomlib/circuits/bitify.circom";

// Pedersen Commitment (hiding-property enhancement)
//
// The existing identity commitment used by vote.circom / comment.circom is
// `Poseidon(DOMAIN_TAG, secret, salt, blindingFactor)`. Poseidon is a
// collision-resistant hash: the commitment is *computationally* hiding
// (breaking it requires inverting Poseidon), but it is not *statistically*
// (information-theoretically) hiding, because for a fixed hash output there
// is in principle a unique preimage tuple.
//
// This template instead uses the Pedersen hash-to-point construction over
// Baby Jubjub (already shipped in circomlib, see `pedersen.circom`), which
// gives:
//   - Perfect (information-theoretic) hiding: for any fixed output point,
//     every value of `secret` is equally likely once `blindingFactor` is
//     drawn uniformly at random and unknown to the observer, because the
//     Pedersen hash of a bitstring is (within the constraints of the
//     hash-to-curve construction) a uniformly random point in the subgroup
//     it maps into.
//   - Computational binding: finding two distinct `(secret, blindingFactor)`
//     pairs that hash to the same point requires solving discrete log in
//     the Baby Jubjub subgroup (equivalent to breaking Pedersen hash
//     collision resistance).
//
// Public output: the x-coordinate of the resulting Baby Jubjub point. Using
// only the x-coordinate (rather than the full point) keeps the commitment
// a single field element, so it can be used as a Merkle tree leaf exactly
// like the current Poseidon-based commitment, without changing the tree's
// arity or leaf encoding.
//
// SECRET_BITS / BLINDING_BITS: number of bits used to represent `secret`
// and `blindingFactor` respectively. Both inputs are range-checked bit-for-bit
// by Num2Bits, which also implicitly enforces `secret < 2^SECRET_BITS` and
// `blindingFactor < 2^BLINDING_BITS`. Callers should pass 256 for both (a
// full byte-aligned width, safely covering the ~2^254 BN254 scalar field)
// so the bit layout matches byte-oriented hosts byte-for-byte: bit `i`
// corresponds to bit `i` of the little-endian byte encoding of the input,
// exactly the convention circomlibjs's `PedersenHash.buffer2bits` uses. This
// keeps the TypeScript reference implementation
// (`frontend/src/lib/pedersenCommitment.ts`) trivially consistent with this
// circuit: `Pedersen(secretLE32Bytes || blindingLE32Bytes)`.
template PedersenCommitment(SECRET_BITS, BLINDING_BITS) {
    signal input secret;
    signal input blindingFactor;

    signal output commitment; // x-coordinate of Pedersen(secret || blindingFactor)
    signal output commitmentY; // y-coordinate (kept available for callers that
                                // want the full point, e.g. formal verification
                                // tooling); not required to identify the commitment.

    component secretBits = Num2Bits(SECRET_BITS);
    secretBits.in <== secret;

    component blindingBits = Num2Bits(BLINDING_BITS);
    blindingBits.in <== blindingFactor;

    var TOTAL_BITS = SECRET_BITS + BLINDING_BITS;
    component pedersen = Pedersen(TOTAL_BITS);

    for (var i = 0; i < SECRET_BITS; i++) {
        pedersen.in[i] <== secretBits.out[i];
    }
    for (var i = 0; i < BLINDING_BITS; i++) {
        pedersen.in[SECRET_BITS + i] <== blindingBits.out[i];
    }

    commitment <== pedersen.out[0];
    commitmentY <== pedersen.out[1];
}
