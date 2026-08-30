//! Browser/WASM API for the ZKVote Groth16 prover.
//!
//! Exposes a `prove` function that takes the zkey bytes and a witness (decimal
//! bigint JSON array, exactly the format circom/snarkjs produce) and returns a
//! snarkjs-compatible `Groth16Proof` object (same `pi_a`/`pi_b`/`pi_c` shape the
//! frontend's `formatProofForSoroban` already consumes), plus the public signals.
//!
//! `r` and `s` are drawn from the platform RNG so each proof is properly blinded.

use wasm_bindgen::prelude::*;

use crate::field::{bigint_to_fr, fq_to_bigint, fr_to_bigint, Fq, Fq2, Fr, G1Affine, G2Affine};
use crate::groth16::{prove as groth16_prove, Proof};
use crate::wtns::parse_wtns;
use crate::zkey::parse_zkey;
use ark_ff::PrimeField;
use num_bigint::BigInt;

fn random_scalars() -> (Fr, Fr) {
    let mut buf = [0u8; 64];
    getrandom::getrandom(&mut buf).expect("rng");
    (
        Fr::from_le_bytes_mod_order(&buf[0..32]),
        Fr::from_le_bytes_mod_order(&buf[32..64]),
    )
}

#[derive(serde::Serialize)]
struct ProofJson {
    pi_a: [String; 2],
    pi_b: [[String; 2]; 2],
    pi_c: [String; 2],
    protocol: String,
    curve: String,
}

#[derive(serde::Serialize)]
struct ProveResult {
    proof: ProofJson,
    #[serde(rename = "publicSignals")]
    public_signals: Vec<String>,
}

fn fq_dec(x: &Fq) -> String {
    // Fq serializes via BigInt decimal of the canonical field element.
    let bi = fq_to_bigint(x);
    bi.to_str_radix(10)
}

fn g1_to_arr(p: &G1Affine) -> [String; 2] {
    [fq_dec(&p.x), fq_dec(&p.y)]
}

fn g2_to_arr(p: &G2Affine) -> [[String; 2]; 2] {
    // snarkjs Groth16Proof shape: [[x.c0, x.c1], [y.c0, y.c1]]
    [
        [fq_dec(&p.x.c0), fq_dec(&p.x.c1)],
        [fq_dec(&p.y.c0), fq_dec(&p.y.c1)],
    ]
}

/// Initialize the WASM module (installs a panic hook that logs to the console).
#[wasm_bindgen]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Generate a Groth16 proof from a binary `.wtns` witness file.
///
/// * `zkey_bytes` — the `.zkey` proving key (same file snarkjs uses).
/// * `wtns_bytes` — the binary `.wtns` witness (snarkjs `wtns_calculate` output).
///
/// This is the preferred entry point from the browser: the frontend computes the
/// witness with the circom WASM (via snarkjs's `wtns_calculate`) and passes the
/// raw bytes straight to Rust, avoiding any decimal JSON round-trip.
#[wasm_bindgen]
pub fn prove_wtns(zkey_bytes: Vec<u8>, wtns_bytes: Vec<u8>) -> Result<JsValue, JsValue> {
    init();
    let pk = parse_zkey(&zkey_bytes).map_err(|e| JsValue::from_str(&format!("zkey: {}", e)))?;
    let wtns = parse_wtns(&wtns_bytes).map_err(|e| JsValue::from_str(&format!("wtns: {}", e)))?;
    if wtns.n_vars != pk.n_vars {
        return Err(JsValue::from_str(&format!(
            "witness length {} != n_vars {}",
            wtns.n_vars, pk.n_vars
        )));
    }
    let (r, s) = random_scalars();
    let proof = groth16_prove(&pk, &wtns.values, r, s);
    serialize_proof(&proof)
}

/// Generate a Groth16 proof from a decimal JSON witness array.
///
/// * `zkey_bytes` — the `.zkey` proving key (same file snarkjs uses).
/// * `witness_json` — JSON array of decimal bigint strings (the circuit witness,
///   position 0 = the `1` signal).
#[wasm_bindgen]
pub fn prove(zkey_bytes: Vec<u8>, witness_json: String) -> Result<JsValue, JsValue> {
    init();
    let pk = parse_zkey(&zkey_bytes).map_err(|e| JsValue::from_str(&format!("zkey: {}", e)))?;

    let arr: Vec<String> = serde_json::from_str(&witness_json)
        .map_err(|e| JsValue::from_str(&format!("witness json: {}", e)))?;
    if arr.len() != pk.n_vars as usize {
        return Err(JsValue::from_str(&format!(
            "witness length {} != n_vars {}",
            arr.len(),
            pk.n_vars
        )));
    }
    let witness: Vec<Fr> = arr
        .iter()
        .map(|s| {
            let v = BigInt::parse_bytes(s.as_bytes(), 10)
                .ok_or_else(|| JsValue::from_str(&format!("bad witness entry: {}", s)))
                .unwrap();
            bigint_to_fr(&v)
        })
        .collect();

    let (r, s) = random_scalars();
    let proof = groth16_prove(&pk, &witness, r, s);
    serialize_proof(&proof)
}

fn serialize_proof(proof: &Proof) -> Result<JsValue, JsValue> {
    let result = ProveResult {
        proof: ProofJson {
            pi_a: g1_to_arr(&proof.pi_a),
            pi_b: g2_to_arr(&proof.pi_b),
            pi_c: g1_to_arr(&proof.pi_c),
            protocol: "groth16".to_string(),
            curve: "bn128".to_string(),
        },
        public_signals: proof.public_signals.clone(),
    };
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&format!("ser: {}", e)))
}
