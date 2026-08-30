//! Compare the Rust prover's (pi_a, pi_b, pi_c) against snarkjs's reference
//! proof (ref0_proof.json, generated with r=s=0). This isolates whether the
//! prover or the verifier is at fault.

use ark_bn254::G1Projective;
use ark_ec::{CurveGroup, VariableBaseMSM};
use ark_ff::{Field, Zero};
use num_bigint::BigInt;
use std::path::PathBuf;
use zkvote_prover::fft::{batch_apply_key, fft, ifft, join_abc, roots, zero_vec};
use zkvote_prover::field::{
    bigint_to_fr, decode_fr_bits, fq_from_decimal, fr_from_decimal, fr_to_bigint, Fq2, Fr,
    G1Affine, G2Affine,
};
use zkvote_prover::groth16::prove;
use zkvote_prover::zkey::parse_zkey;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

fn g1(s: &serde_json::Value, key: &str) -> G1Affine {
    G1Affine::new(
        fq_from_decimal(s[key][0].as_str().unwrap()),
        fq_from_decimal(s[key][1].as_str().unwrap()),
    )
}
fn g2(s: &serde_json::Value, key: &str) -> G2Affine {
    G2Affine::new(
        Fq2::new(
            fq_from_decimal(s[key][0][0].as_str().unwrap()),
            fq_from_decimal(s[key][0][1].as_str().unwrap()),
        ),
        Fq2::new(
            fq_from_decimal(s[key][1][0].as_str().unwrap()),
            fq_from_decimal(s[key][1][1].as_str().unwrap()),
        ),
    )
}

#[test]
fn prove_matches_ref() {
    let root = repo_root();
    let zkey_path = root.join("frontend/public/circuits/vote_final.zkey");
    let wit_path = root.join("circuits/test_witness_vote.json");
    let ref0_path = root.join("circuits/_dbg/ref0_proof.json");
    if !zkey_path.exists() || !wit_path.exists() || !ref0_path.exists() {
        eprintln!("circuit files missing; skipping prove_matches_ref test");
        return;
    }
    let zkey_bytes = std::fs::read(&zkey_path).unwrap();
    let pk = parse_zkey(&zkey_bytes).expect("parse zkey");
    let raw = std::fs::read_to_string(&wit_path).unwrap();
    let arr: Vec<String> = serde_json::from_str(&raw).unwrap();
    let witness: Vec<Fr> = arr
        .iter()
        .map(|s| {
            let v = BigInt::parse_bytes(s.as_bytes(), 10).unwrap();
            fr_from_decimal(&v.to_str_radix(10))
        })
        .collect();

    let proof = prove(&pk, &witness, Fr::zero(), Fr::zero());

    let ref0: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&ref0_path).unwrap()).unwrap();

    let r_pi_a = g1(&ref0, "pi_a");
    let r_pi_b = g2(&ref0, "pi_b");
    let r_pi_c = g1(&ref0, "pi_c");

    eprintln!("pi_a match? {}", proof.pi_a == r_pi_a);
    eprintln!("pi_b match? {}", proof.pi_b == r_pi_b);
    eprintln!("pi_c match? {}", proof.pi_c == r_pi_c);

    if proof.pi_a != r_pi_a {
        eprintln!("mine pi_a = {:?}", proof.pi_a);
        eprintln!("ref  pi_a = {:?}", r_pi_a);
    }
    if proof.pi_b != r_pi_b {
        eprintln!("mine pi_b = {:?}", proof.pi_b);
        eprintln!("ref  pi_b = {:?}", r_pi_b);
    }
    if proof.pi_c != r_pi_c {
        eprintln!("mine pi_c = {:?}", proof.pi_c);
        eprintln!("ref  pi_c = {:?}", r_pi_c);
    }

    // Diagnose resH vs C_w.
    let n_public = pk.n_public as usize;
    let c_w: G1Projective = G1Projective::msm(&pk.c, &witness[n_public + 1..]).expect("c_w");
    let res_h_mine = G1Projective::from(proof.pi_c) - c_w;
    let p_buf = std::fs::read(root.join("circuits/_dbg/buffPodd_T_snarkjs.bin")).unwrap();
    let n = pk.domain_size as usize;
    let p_ref: Vec<Fr> = (0..n)
        .map(|i| decode_fr_bits(&p_buf[i * 32..i * 32 + 32], 0))
        .collect();
    let res_h_ref: G1Projective = G1Projective::msm(&pk.h, &p_ref).expect("resH_ref");
    let c_w_ref = G1Projective::from(r_pi_c) - res_h_ref;
    eprintln!(
        "resH_mine == resH_ref (snark buffers)? {}",
        res_h_mine.into_affine() == res_h_ref.into_affine()
    );
    eprintln!(
        "c_w_mine  == c_w_ref (snark buffers)? {}",
        c_w.into_affine() == c_w_ref.into_affine()
    );

    // Replicate buildABC1 + join_abc and compare element-wise to snark canonical P.
    let (omega, inc) = roots(pk.domain_size);
    let domain_size = pk.domain_size as usize;
    let mut a = zero_vec(domain_size);
    let mut b = zero_vec(domain_size);
    for coef in &pk.coefs {
        let w = witness[coef.signal as usize];
        let term = coef.value * w;
        match coef.matrix as usize {
            0 => a[coef.constraint as usize] += term,
            1 => b[coef.constraint as usize] += term,
            _ => {}
        }
    }
    let mut c = a
        .iter()
        .zip(b.iter())
        .map(|(x, y)| *x * *y)
        .collect::<Vec<_>>();
    for v in [&mut a, &mut b, &mut c] {
        ifft(v, omega);
        batch_apply_key(v, inc);
        fft(v, omega);
    }
    let p_mine = join_abc(&a, &b, &c);
    // Hypothesis: snarkjs WASM reads C (2^240) as 2^248 => C*2^-8, so
    // canonical P = A*B - C/256.
    let inv256 = <Fr as ark_ff::Field>::inverse(&bigint_to_fr(&BigInt::from(256u32))).unwrap();
    let p_alt: Vec<Fr> = (0..domain_size)
        .map(|i| a[i] * b[i] - c[i] * inv256)
        .collect();
    let mut mism = 0usize;
    for i in 0..domain_size {
        if p_mine[i] != p_ref[i] {
            mism += 1;
        }
    }
    let mut mism_alt = 0usize;
    for i in 0..domain_size {
        if p_alt[i] != p_ref[i] {
            mism_alt += 1;
        }
    }
    eprintln!("P element mismatches (a*b-c): {}/{}", mism, domain_size);
    eprintln!(
        "P element mismatches (a*b-c/256): {}/{}",
        mism_alt, domain_size
    );

    // Deduce relation at index 0: is p0 = a0*b0 - c0*2^k for some k?
    let a0 = a[0];
    let b0 = b[0];
    let c0 = c[0];
    let p0 = p_ref[0];
    let d = a0 * b0 - p0;
    eprintln!("a0 = {:?}", fr_to_bigint(&a0));
    eprintln!("b0 = {:?}", fr_to_bigint(&b0));
    eprintln!("c0 = {:?}", fr_to_bigint(&c0));
    eprintln!("p0 = {:?}", fr_to_bigint(&p0));
    eprintln!("d = a0*b0-p0 = {:?}", fr_to_bigint(&d));
    let two = bigint_to_fr(&BigInt::from(2u32));
    for k in -16..=16i32 {
        let mut f = bigint_to_fr(&BigInt::from(1u32));
        if k >= 0 {
            for _ in 0..k {
                f *= two;
            }
        } else {
            let inv2 = <Fr as Field>::inverse(&two).unwrap();
            for _ in k..0 {
                f *= inv2;
            }
        }
        let cand = c0 * f;
        if cand == d {
            eprintln!("MATCH: p0 = a0*b0 - c0*2^{}", k);
        }
    }

    // Directly compare canonical coset values to snark ODD dumps (post 2nd transform).
    let at = std::fs::read(root.join("circuits/_dbg/buffAodd_T_snarkjs.bin")).unwrap();
    let bt = std::fs::read(root.join("circuits/_dbg/buffBodd_T_snarkjs.bin")).unwrap();
    let ct = std::fs::read(root.join("circuits/_dbg/buffCodd_T_snarkjs.bin")).unwrap();
    let ref_a: Vec<Fr> = (0..domain_size)
        .map(|i| decode_fr_bits(&at[i * 32..i * 32 + 32], 248))
        .collect();
    let ref_b: Vec<Fr> = (0..domain_size)
        .map(|i| decode_fr_bits(&bt[i * 32..i * 32 + 32], 248))
        .collect();
    let ref_c: Vec<Fr> = (0..domain_size)
        .map(|i| decode_fr_bits(&ct[i * 32..i * 32 + 32], 240))
        .collect();
    for (name, mine, rref) in [("A", &a, &ref_a), ("B", &b, &ref_b), ("C", &c, &ref_c)] {
        let mm = (0..domain_size).filter(|&i| mine[i] != rref[i]).count();
        eprintln!(
            "{} coset canonical mismatches: {}/{}",
            name, mm, domain_size
        );
        if mm > 0 {
            let i = (0..domain_size).find(|&i| mine[i] != rref[i]).unwrap();
            eprintln!(
                "  {}[{}] mine={:?} ref={:?}",
                name,
                i,
                fr_to_bigint(&mine[i]),
                fr_to_bigint(&rref[i])
            );
        }
    }

    assert!(proof.pi_a == r_pi_a && proof.pi_b == r_pi_b && proof.pi_c == r_pi_c);
}
