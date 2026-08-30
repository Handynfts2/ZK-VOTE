//! ZKVote Rust BN254 Groth16 prover + circomlib-compatible Poseidon.
//!
//! This crate provides a pure-Rust, WASM-buildable implementation of the
//! cryptographic primitives the ZKVote frontend needs to generate Groth16
//! proofs client-side, replacing the `snarkjs` default path while keeping
//! byte-for-byte parity with the on-chain verifier (which uses the same BN254
//! host functions / verification key).

pub mod binfile;
pub mod fft;
pub mod field;
pub mod groth16;
pub mod poseidon;
pub mod r1cs;
pub mod wtns;
pub mod zkey;

#[cfg(feature = "witness")]
pub mod witness_wasm;

#[cfg(feature = "wasm")]
pub mod wasm;
