//! Validates the Rust witness generator (wasmtime) end-to-end against a real
//! Circom2 circuit: compute the witness from circuit inputs, then check it
//! satisfies the constraint system (R1CS). This is the "Rust witness
//! generation" deliverable, exercised without a browser.
//!
//! NOTE: a witness that satisfies the R1CS is, by definition, a correct witness
//! for the circuit — this is the gold-standard correctness check and does not
//! depend on the (separate) Rust `poseidon` implementation.

#![cfg(feature = "witness")]

use std::path::PathBuf;

use zkvote_prover::r1cs::{check_witness, parse_r1cs};
use zkvote_prover::witness_wasm::calculate_witness;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

#[test]
fn test_poseidon_witness_satisfies_r1cs() {
    let root = root();
    let wasm_path = root.join("circuits/build_test/test_poseidon_js/test_poseidon.wasm");
    let r1cs_path = root.join("circuits/build_test/test_poseidon.r1cs");
    if !wasm_path.exists() || !r1cs_path.exists() {
        eprintln!("wasm or r1cs missing; skipping test_poseidon_witness_satisfies_r1cs");
        return;
    }
    let wasm = std::fs::read(&wasm_path).expect("read circuit wasm");
    let input = r#"{"a": 1, "b": 2, "c": 3}"#;
    let witness = calculate_witness(&wasm, input).expect("compute witness");

    let r1cs = parse_r1cs(&r1cs_path);
    let violations = check_witness(&r1cs, &witness);
    assert_eq!(violations, 0, "witness must satisfy the R1CS");
}
