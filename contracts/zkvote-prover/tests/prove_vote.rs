//! End-to-end validation: parse the production `vote_final.zkey`, load a real
//! witness, generate a proof with the Rust prover, and verify it under the same
//! verification key. A passing `verify` validates the zkey parser, witness
//! parser, FFT/coset transforms, MSMs and the Groth16 combinator against the
//! on-chain (BN254) verifier.

use std::path::PathBuf;

use ark_ff::Zero;
use num_bigint::BigInt;
use zkvote_prover::field::{bigint_to_fr, fr_to_bigint, Fr};
use zkvote_prover::groth16::{prove, verify};
use zkvote_prover::zkey::parse_zkey;

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR = contracts/zkvote-prover
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

#[test]
fn prove_and_verify_vote() {
    let root = repo_root();
    let zkey_path = root.join("frontend/public/circuits/vote_final.zkey");
    let wtns_path = root.join("circuits/test_witness_vote.json");
    if !zkey_path.exists() || !wtns_path.exists() {
        eprintln!("zkey or witness missing; skipping prove_and_verify_vote test");
        return;
    }
    let zkey_bytes = std::fs::read(&zkey_path).expect("read zkey");
    let pk = parse_zkey(&zkey_bytes).expect("parse zkey");

    let raw = std::fs::read_to_string(&wtns_path).expect("read witness json");
    let arr: Vec<String> = serde_json::from_str(&raw).expect("json array");
    assert_eq!(arr.len(), pk.n_vars as usize, "witness length mismatch");
    let witness: Vec<Fr> = arr
        .iter()
        .map(|s| bigint_to_fr(&BigInt::parse_bytes(s.as_bytes(), 10).unwrap()))
        .collect();

    let proof = prove(&pk, &witness, Fr::zero(), Fr::zero());

    // Re-derive public signals as Fr from the witness to feed the verifier.
    let pub_fr: Vec<Fr> = witness[1..=(pk.n_public as usize)].to_vec();

    assert!(verify(&pk, &proof, &pub_fr), "proof failed verification");

    // The proof's public signals must equal the circuit public outputs.
    let expected: Vec<String> = witness[1..=(pk.n_public as usize)]
        .iter()
        .map(|f| fr_to_bigint(f).to_str_radix(10))
        .collect();
    assert_eq!(proof.public_signals, expected);
}
