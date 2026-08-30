//! Generate a Groth16 proof with the Rust prover and write it (plus public
//! signals) in snarkjs-compatible JSON so it can be checked with
//! `snarkjs groth16 verify`.

use num_traits::Zero;
use std::path::PathBuf;
use zkvote_prover::field::{fq_to_bigint, Fr, G1Affine, G2Affine};
use zkvote_prover::groth16::prove;
use zkvote_prover::r1cs::{load_witness_decimal, parse_r1cs};
use zkvote_prover::zkey::parse_zkey;

fn repo_root() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.pop();
    p
}

fn main() {
    let root = repo_root();
    let zkey_bytes = std::fs::read(root.join("frontend/public/circuits/vote_final.zkey")).unwrap();
    let pk = parse_zkey(&zkey_bytes).expect("parse zkey");
    let r1cs = parse_r1cs(&root.join("circuits/build/vote.r1cs"));
    let witness = load_witness_decimal(&root.join("circuits/test_witness_vote.json"));

    let proof = prove(&pk, &witness, Fr::zero(), Fr::zero());
    let public = &proof.public_signals;

    let g1 = |p: G1Affine| -> [String; 3] {
        let x = fq_to_bigint(&p.x);
        let y = fq_to_bigint(&p.y);
        [x.to_str_radix(10), y.to_str_radix(10), "1".to_string()]
    };
    let g2 = |p: G2Affine| -> serde_json::Value {
        let xc0 = fq_to_bigint(&p.x.c0);
        let xc1 = fq_to_bigint(&p.x.c1);
        let yc0 = fq_to_bigint(&p.y.c0);
        let yc1 = fq_to_bigint(&p.y.c1);
        serde_json::json!([
            [xc0.to_str_radix(10), xc1.to_str_radix(10)],
            [yc0.to_str_radix(10), yc1.to_str_radix(10)],
            ["1", "0"]
        ])
    };

    let proof_json = serde_json::json!({
        "pi_a": g1(proof.pi_a),
        "pi_b": g2(proof.pi_b),
        "pi_c": g1(proof.pi_c),
        "protocol": "groth16",
        "curve": "bn128",
    });
    let public_json: Vec<String> = public.clone();

    std::fs::write(
        root.join("circuits/rust_proof.json"),
        serde_json::to_string_pretty(&proof_json).unwrap(),
    )
    .unwrap();
    std::fs::write(
        root.join("circuits/rust_public.json"),
        serde_json::to_string_pretty(&public_json).unwrap(),
    )
    .unwrap();
    eprintln!("wrote rust_proof.json / rust_public.json");
    eprintln!("public signals: {:?}", public);
    let _ = r1cs;
}
