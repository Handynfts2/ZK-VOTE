//! Field FFT/IFFT over the BN254 scalar field, matching snarkjs's natural-order
//! radix-2 DIT convention (so the resulting evaluation aligns with the zkey
//! `hExps`/`A`/`B`/`C` bases).

use crate::field::{fr_modulus, Fr};
use ark_ff::{Field, Zero};
use num_bigint::BigInt;
use num_traits::One;

/// Compute the coset FFT roots for a domain of size `domain_size` (= 2^power):
/// * `omega` = primitive `domain_size`-th root of unity
/// * `inc`   = primitive `(domain_size*2)`-th root of unity (coset factor)
pub fn roots(domain_size: u32) -> (Fr, Fr) {
    let r = fr_modulus();
    let one = BigInt::one();
    let two = BigInt::from(2u32);
    let r_minus_1 = &r - &one;
    let half = &r_minus_1 / &two;

    // smallest integer nqr >= 2 that is a quadratic non-residue
    let mut nqr = two.clone();
    loop {
        let e = nqr.modpow(&half, &r);
        if e != one {
            break;
        }
        nqr += &one;
    }

    let power = domain_size.trailing_zeros();
    let root_pow = &r_minus_1 >> power; // (r-1) / 2^power
    let inc_pow = &r_minus_1 >> (power + 1); // (r-1) / 2^(power+1)

    let omega = bigint_to_fr(&nqr.modpow(&root_pow, &r));
    let inc = bigint_to_fr(&nqr.modpow(&inc_pow, &r));
    (omega, inc)
}

fn bigint_to_fr(v: &BigInt) -> Fr {
    crate::field::bigint_to_fr(v)
}

/// In-place iterative natural-order FFT with the given primitive root.
pub fn fft(a: &mut [Fr], omega: Fr) {
    let n = a.len();
    if n <= 1 {
        return;
    }
    debug_assert!(n.is_power_of_two());
    bit_reverse_permute(a);
    let mut len = 2;
    while len <= n {
        // wlen = omega^(n/len): primitive len-th root
        let wlen = omega.pow([(n / len) as u64]);
        let mut i = 0;
        while i < n {
            let mut w = Fr::one();
            for k in 0..len / 2 {
                let u = a[i + k];
                let v = a[i + k + len / 2] * w;
                a[i + k] = u + v;
                a[i + k + len / 2] = u - v;
                w *= wlen;
            }
            i += len;
        }
        len <<= 1;
    }
}

/// In-place iterative IFFT (inverse of [`fft`]).
pub fn ifft(a: &mut [Fr], omega: Fr) {
    let n = a.len() as u64;
    let omega_inv = omega.inverse().unwrap();
    fft(a, omega_inv);
    let n_inv = Fr::from(n).inverse().unwrap();
    for x in a.iter_mut() {
        *x *= n_inv;
    }
}

fn bit_reverse_permute(a: &mut [Fr]) {
    let n = a.len();
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            a.swap(i, j);
        }
    }
}

/// Multiply element `i` by `inc^i` (coset shift).
pub fn batch_apply_key(a: &mut [Fr], inc: Fr) {
    let mut w = Fr::one();
    for x in a.iter_mut() {
        *x *= w;
        w *= inc;
    }
}

/// Elementwise `a[i] * b[i] - c[i]`.
pub fn join_abc(a: &[Fr], b: &[Fr], c: &[Fr]) -> Vec<Fr> {
    a.iter()
        .zip(b.iter())
        .zip(c.iter())
        .map(|((x, y), z)| *x * *y - *z)
        .collect()
}

/// Allocate a zero vector of `domain_size` usable as an FFT buffer.
pub fn zero_vec(domain_size: usize) -> Vec<Fr> {
    vec![Fr::zero(); domain_size]
}
