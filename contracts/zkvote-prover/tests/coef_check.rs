//! Regression test for snarkjs zkey `ccoef` coefficient decoding, focused on
//! the **sign bit**.
//!
//! snarkjs stores every `ccoef` in `2^504` Montgomery form as 32 little-endian
//! bytes, with the top bit of byte 31 set when the value is negative. Before
//! this was honored, negative coefficients decoded as huge positive numbers,
//! silently corrupting the proving key (the prover still "verified" against
//! itself but produced proofs an external/on-chain verifier would reject).
//!
//! This test round-trips known values (including negatives) through the exact
//! on-disk encoding snarkjs uses and asserts `decode_fr_zk_coef` recovers them.

use num_bigint::BigInt;
use zkvote_prover::field::{bigint_to_fr, decode_fr_zk_coef};

/// BN254 scalar field modulus.
const Q_STR: &str = "21888242871839275222246405745257275088548364400416034343698204186575808495617";

/// Encode `v` the way snarkjs writes a zkey coefficient: `v * 2^504 mod q`
/// little-endian, with bit 7 of byte 31 set iff `v < 0`.
fn enc_coef(v: &BigInt, q: &BigInt) -> [u8; 32] {
    let neg = *v < BigInt::from(0);
    // snarkjs stores the *magnitude* (|v|) with the sign bit set when negative.
    let mag = if neg { -v } else { v.clone() };
    let mag = &mag % q;
    let mut r504 = BigInt::from(1);
    for _ in 0..504u32 {
        r504 = (&r504 * 2u32) % q;
    }
    let enc = (&mag * &r504) % q;
    let mut b = [0u8; 32];
    let mut e = enc;
    for slot in &mut b {
        *slot = u8_of(&e);
        e >>= 8;
    }
    if neg {
        b[31] |= 0x80;
    }
    b
}

fn u8_of(b: &BigInt) -> u8 {
    let rem = b.clone() % BigInt::from(256u32);
    let rem = if rem < BigInt::from(0) {
        rem + BigInt::from(256u32)
    } else {
        rem
    };
    rem.to_string().parse::<u8>().unwrap()
}

fn fr_of(v: i128, q: &BigInt) -> zkvote_prover::field::Fr {
    let v = BigInt::from(v);
    let vmod = ((&v % q) + q) % q;
    bigint_to_fr(&vmod)
}

#[test]
fn zk_coef_sign_bit_is_honored() {
    let q: BigInt = Q_STR.parse().unwrap();

    // (value, expected decoded) — negatives must come back negative.
    let cases: Vec<(i128, i128)> = vec![
        (0, 0),
        (1, 1),
        (5, 5),
        (12345, 12345),
        (-1, -1),
        (-2, -2),
        (-12345, -12345),
        (i128::MAX / 2, i128::MAX / 2),
        (-1000000000000, -1000000000000),
    ];

    for (v, expect) in &cases {
        let bytes = enc_coef(&BigInt::from(*v), &q);
        // Sanity: the sign bit reflects the sign of the encoded value.
        let sign_set = bytes[31] & 0x80 != 0;
        assert_eq!(sign_set, *v < 0, "sign bit mismatch for {}", v);

        let got = decode_fr_zk_coef(&bytes);
        let want = fr_of(*expect, &q);
        assert_eq!(got, want, "decode mismatch for value {}", v);
    }

    // q - 1 == -1 mod q: must decode to the same value as -1 (sign bit set).
    let neg_one = enc_coef(&BigInt::from(-1), &q);
    let q_minus_one = enc_coef(&(&q - BigInt::from(1)), &q);
    assert_eq!(
        decode_fr_zk_coef(&neg_one),
        decode_fr_zk_coef(&q_minus_one),
        "q-1 and -1 must decode identically"
    );
}
