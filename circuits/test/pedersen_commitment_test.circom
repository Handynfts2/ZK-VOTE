pragma circom 2.0.0;

include "../pedersen_commitment.circom";

// Standalone test instantiation of the Pedersen commitment template.
// 256-bit (byte-aligned) secret / blinding factor, matching the
// TypeScript reference implementation's little-endian byte packing.
component main = PedersenCommitment(256, 256);
