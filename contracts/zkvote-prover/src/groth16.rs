//! Groth16 prover and verifier compatible with snarkjs-produced `.zkey` files.

use crate::fft::{batch_apply_key, fft, ifft, join_abc, roots, zero_vec};
use crate::field::{fr_to_bigint, Fr, G1Affine, G2Affine};
use crate::zkey::ProvingKey;
use ark_bn254::{Bn254, G1Projective, G2Projective};
use ark_ec::{CurveGroup, VariableBaseMSM};
use ark_ff::Field;
use num_bigint::BigInt;

#[derive(Clone)]
pub struct Proof {
    pub pi_a: G1Affine,
    pub pi_b: G2Affine,
    pub pi_c: G1Affine,
    pub public_signals: Vec<String>,
}

fn msm_g1(bases: &[G1Affine], scalars: &[Fr]) -> G1Projective {
    G1Projective::msm(bases, scalars).expect("msm g1")
}

fn msm_g2(bases: &[G2Affine], scalars: &[Fr]) -> G2Projective {
    G2Projective::msm(bases, scalars).expect("msm g2")
}

/// Generate a Groth16 proof for the given witness under `pk`.
///
/// `r` and `s` are the prover randomness; pass `Fr::zero()` for a deterministic
/// (still valid) proof.
pub fn prove(pk: &ProvingKey, witness: &[Fr], r: Fr, s: Fr) -> Proof {
    let domain_size = pk.domain_size as usize;
    let (omega, inc) = roots(pk.domain_size);

    // buildABC1: accumulate A/B coefficient vectors from ccoefs, C = A*B.
    let mut a = zero_vec(domain_size);
    let mut b = zero_vec(domain_size);
    for coef in &pk.coefs {
        let w = witness[coef.signal as usize];
        let term = coef.value * w;
        match coef.matrix {
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

    ifft(&mut a, omega);
    batch_apply_key(&mut a, inc);
    fft(&mut a, omega);

    ifft(&mut b, omega);
    batch_apply_key(&mut b, inc);
    fft(&mut b, omega);

    ifft(&mut c, omega);
    batch_apply_key(&mut c, inc);
    fft(&mut c, omega);

    let p = join_abc(&a, &b, &c);
    // snarkjs's `qap_joinABC` WASM operates with R = 2^256 and reads A/B (2^248-Mont)
    // and C (2^240-Mont) as 2^256-Mont, then batchFromMontgomery (÷2^256) yields
    // P = (A*B - C) * 2^-16. Reproduce that final 2^-16 factor on the canonical join.
    let inv2_16 = <Fr as Field>::inverse(&Fr::from(65536u64)).unwrap();
    let p: Vec<Fr> = p.into_iter().map(|x| x * inv2_16).collect();

    let pi_a = {
        let mut acc = msm_g1(&pk.a, witness);
        acc += pk.vk_alpha_1;
        acc += G1Projective::from(pk.vk_delta_1) * r;
        acc
    };
    let pi_b = {
        let mut acc = msm_g2(&pk.b2, witness);
        acc += pk.vk_beta_2;
        acc += G2Projective::from(pk.vk_delta_2) * s;
        acc
    };
    let pib1 = {
        let mut acc = msm_g1(&pk.b1, witness);
        acc += pk.vk_beta_1;
        acc += G1Projective::from(pk.vk_delta_1) * s;
        acc
    };
    let res_h = msm_g1(&pk.h, &p);
    let pi_c = {
        let n_public = pk.n_public as usize;
        let mut acc = msm_g1(&pk.c, &witness[n_public + 1..]);
        acc += res_h;
        acc += pi_a * s;
        acc += pib1 * r;
        acc -= G1Projective::from(pk.vk_delta_1) * (r * s);
        acc
    };

    let mut public_signals = Vec::with_capacity(pk.n_public as usize);
    for sig in witness.iter().take(pk.n_public as usize + 1).skip(1) {
        let v: BigInt = fr_to_bigint(sig);
        public_signals.push(v.to_str_radix(10));
    }

    Proof {
        pi_a: pi_a.into_affine(),
        pi_b: pi_b.into_affine(),
        pi_c: pi_c.into_affine(),
        public_signals,
    }
}

/// Verify a proof against the proving key's embedded verification key.
pub fn verify(pk: &ProvingKey, proof: &Proof, public_signals: &[Fr]) -> bool {
    use ark_ec::pairing::Pairing;
    let pi_a = proof.pi_a;
    let pi_b = proof.pi_b;
    let pi_c = proof.pi_c;

    // vk_x = IC[0] + sum_i IC[i] * pub[i-1]
    let mut vk_x = G1Projective::from(pk.ic[0]);
    for (i, pub_i) in public_signals.iter().enumerate() {
        let term = G1Projective::from(pk.ic[i + 1]) * *pub_i;
        vk_x += term;
    }

    let lhs = Bn254::pairing(
        <Bn254 as Pairing>::G1Prepared::from(pi_a),
        <Bn254 as Pairing>::G2Prepared::from(pi_b),
    );
    let rhs = Bn254::pairing(
        <Bn254 as Pairing>::G1Prepared::from(pk.vk_alpha_1),
        <Bn254 as Pairing>::G2Prepared::from(pk.vk_beta_2),
    ) + Bn254::pairing(
        <Bn254 as Pairing>::G1Prepared::from(vk_x.into_affine()),
        <Bn254 as Pairing>::G2Prepared::from(pk.vk_gamma_2),
    ) + Bn254::pairing(
        <Bn254 as Pairing>::G1Prepared::from(pi_c),
        <Bn254 as Pairing>::G2Prepared::from(pk.vk_delta_2),
    );
    lhs == rhs
}
