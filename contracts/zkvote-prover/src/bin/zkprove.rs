//! `zkprove` — ZKVote Rust prover CLI.
//!
//! Generates a Groth16 proof entirely in Rust:
//!   * witness from a compiled Circom2 WASM (`--wasm` + `--input`), or from a
//!     precomputed `.wtns` / JSON witness (`--wtns` / `--witness-json`);
//!   * proof with the Rust BN254 Groth16 prover;
//!   * snarkjs-compatible `proof.json` + `public.json` output.
//!
//! This is the Rust side of `scripts/test/e2e-zkproof.sh` and replaces the
//! `snarkjs wtns calculate` + `groth16 prove` steps.

use std::path::PathBuf;

use ark_ff::PrimeField;
use num_bigint::BigInt;
use serde_json::{json, Value};
use zkvote_prover::field::{bigint_to_fr, fq_to_bigint, Fq, Fq2, Fr, G1Affine, G2Affine};
use zkvote_prover::groth16::{prove, Proof};
use zkvote_prover::wtns::parse_wtns;
use zkvote_prover::zkey::parse_zkey;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

fn g1_json(p: &G1Affine) -> Value {
    json!([
        fq_to_bigint(&p.x).to_string(),
        fq_to_bigint(&p.y).to_string()
    ])
}
fn g2_json(p: &G2Affine) -> Value {
    json!([
        [
            fq_to_bigint(&p.x.c0).to_string(),
            fq_to_bigint(&p.x.c1).to_string()
        ],
        [
            fq_to_bigint(&p.y.c0).to_string(),
            fq_to_bigint(&p.y.c1).to_string()
        ]
    ])
}

fn write_outputs(proof: &Proof, out_proof: &str, out_pub: &str) {
    let proof_json = json!({
        "pi_a": g1_json(&proof.pi_a),
        "pi_b": g2_json(&proof.pi_b),
        "pi_c": g1_json(&proof.pi_c),
        "protocol": "groth16",
        "curve": "bn128",
    });
    std::fs::write(
        out_proof,
        serde_json::to_string_pretty(&proof_json).unwrap(),
    )
    .expect("write proof");
    std::fs::write(
        out_pub,
        serde_json::to_string_pretty(&proof.public_signals).unwrap(),
    )
    .expect("write public");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut wasm_path = None;
    let mut input_path = None;
    let mut wtns_path = None;
    let mut witness_json_path = None;
    let mut zkey_path = "frontend/public/circuits/vote_final.zkey".to_string();
    let mut out_proof = "proof.json".to_string();
    let mut out_pub = "public.json".to_string();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--wasm" => {
                wasm_path = Some(args[i + 1].clone());
                i += 2;
            }
            "--input" => {
                input_path = Some(args[i + 1].clone());
                i += 2;
            }
            "--wtns" => {
                wtns_path = Some(args[i + 1].clone());
                i += 2;
            }
            "--witness-json" => {
                witness_json_path = Some(args[i + 1].clone());
                i += 2;
            }
            "--zkey" => {
                zkey_path = args[i + 1].clone();
                i += 2;
            }
            "--out-proof" => {
                out_proof = args[i + 1].clone();
                i += 2;
            }
            "--out-public" => {
                out_pub = args[i + 1].clone();
                i += 2;
            }
            other => {
                eprintln!("unknown arg: {other}");
                std::process::exit(2);
            }
        }
    }

    let zkey_bytes = std::fs::read(&zkey_path).expect("read zkey");
    let pk = parse_zkey(&zkey_bytes).expect("parse zkey");

    let witness: Vec<Fr> = if let Some(w) = wasm_path {
        let wasm_bytes = std::fs::read(&w).expect("read circuit wasm");
        let input = std::fs::read_to_string(input_path.expect("--input required with --wasm"))
            .expect("read input json");
        zkvote_prover::witness_wasm::calculate_witness(&wasm_bytes, &input)
            .expect("compute witness")
    } else if let Some(w) = wtns_path {
        let wtns_bytes = std::fs::read(&w).expect("read wtns");
        parse_wtns(&wtns_bytes).expect("parse wtns").values
    } else if let Some(w) = witness_json_path {
        let raw = std::fs::read_to_string(&w).expect("read witness json");
        let arr: Vec<String> = serde_json::from_str(&raw).expect("json array");
        arr.iter()
            .map(|s| bigint_to_fr(&BigInt::parse_bytes(s.as_bytes(), 10).unwrap()))
            .collect()
    } else {
        eprintln!("provide one of --wasm/--input, --wtns, or --witness-json");
        std::process::exit(2);
    };

    assert_eq!(witness.len(), pk.n_vars as usize, "witness length mismatch");

    let mut buf = [0u8; 64];
    getrandom::getrandom(&mut buf).expect("rng");
    let r = Fr::from_le_bytes_mod_order(&buf[0..32]);
    let s = Fr::from_le_bytes_mod_order(&buf[32..64]);

    let proof = prove(&pk, &witness, r, s);
    write_outputs(&proof, &out_proof, &out_pub);
    println!("proof written to {out_proof} / {out_pub}");
}
