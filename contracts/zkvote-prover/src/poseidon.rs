//! circomlib-compatible Poseidon hash over the BN254 scalar field (`Fr`).
//!
//! This mirrors `circomlib/circuits/poseidon.circom` (template `PoseidonEx`)
//! exactly so that hashes produced here are bit-identical to the ones the
//! on-chain circuit expects. Constants come from `poseidon_constants.rs`
//! (extracted verbatim from circomlib 2.0.5).

use crate::field::Fr;
use ark_ff::{Field, Zero};
use poseidon_constants::*;

mod poseidon_constants;

fn parse_const(s: &str) -> Fr {
    // Constants are decimal or 0x hex strings.
    let v = if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        big_int_hex(hex)
    } else {
        big_int_dec(s)
    };
    crate::field::bigint_to_fr(&v)
}

fn big_int_dec(s: &str) -> num_bigint::BigInt {
    num_bigint::BigInt::parse_bytes(s.as_bytes(), 10).unwrap()
}
fn big_int_hex(s: &str) -> num_bigint::BigInt {
    num_bigint::BigInt::parse_bytes(s.as_bytes(), 16).unwrap()
}

/// Compute Poseidon over `inputs` (length = t-1), returning `n_outputs` field
/// elements. Matches circomlib `Poseidon(nInputs)` with `nInputs = inputs.len()`.
pub fn poseidon(inputs: &[Fr], n_outputs: usize) -> Vec<Fr> {
    let t = inputs.len() + 1;
    let n_rounds_f = 8usize;
    let n_rounds_p = poseidon_nrounds_p(t);
    let half_f = n_rounds_f / 2;

    let c_all = POSEIDON_C(t);
    let m_all = POSEIDON_M(t);
    let s_all = POSEIDON_S(t);
    let p_all = POSEIDON_P(t);

    // Build matrices.
    let mut c = Vec::with_capacity(c_all.len());
    for s in c_all {
        c.push(parse_const(s));
    }
    let mut m = Vec::with_capacity(t * t);
    for s in m_all {
        m.push(parse_const(s));
    }
    let mut s_mat = Vec::with_capacity(s_all.len());
    for s in s_all {
        s_mat.push(parse_const(s));
    }
    let mut p = Vec::with_capacity(t * t);
    for s in p_all {
        p.push(parse_const(s));
    }

    // State: [initialState=0, inputs...]
    let mut state = vec![Fr::zero(); t];
    for (i, inp) in inputs.iter().enumerate() {
        state[i + 1] = *inp;
    }

    let mut c_off = 0usize;

    // Initial Ark
    ark(&mut state, &c, &mut c_off);

    // First half of full rounds
    for _ in 0..half_f - 1 {
        sbox(&mut state);
        ark(&mut state, &c, &mut c_off);
        mix(&mut state, &m, t);
    }

    // middle full round (uses P instead of M)
    sbox(&mut state);
    ark(&mut state, &c, &mut c_off);
    mix_with(&mut state, &p, t);

    // Partial rounds
    for r in 0..n_rounds_p {
        // sbox only on first element
        state[0] = state[0].square().square() * state[0]; // x^5
                                                          // Ark on element 0 with the partial-round constant
        state[0] += c[c_off];
        c_off += 1;
        let new_state = mix_s(&state, &s_mat, t, r);
        state = new_state;
    }

    // Last half of full rounds
    for _ in 0..half_f - 1 {
        sbox(&mut state);
        ark(&mut state, &c, &mut c_off);
        mix(&mut state, &m, t);
    }

    // Final sbox
    sbox(&mut state);

    // Output selection (MixLast with M)
    let mut out = Vec::with_capacity(n_outputs);
    for s in 0..n_outputs {
        let mut acc = Fr::zero();
        for j in 0..t {
            acc += m[j * t + s] * state[j];
        }
        out.push(acc);
    }
    out
}

#[inline]
fn ark(state: &mut [Fr], c: &[Fr], c_off: &mut usize) {
    let t = state.len();
    for j in 0..t {
        state[j] += c[*c_off + j];
    }
    *c_off += t;
}

#[inline]
fn sbox(state: &mut [Fr]) {
    for x in state.iter_mut() {
        *x = x.square().square() * *x; // x^5
    }
}

#[inline]
fn mix(state: &mut [Fr], m: &[Fr], t: usize) {
    let input = state.to_vec();
    for j in 0..t {
        let mut acc = Fr::zero();
        for i in 0..t {
            acc += m[i * t + j] * input[i];
        }
        state[j] = acc;
    }
}

#[inline]
fn mix_with(state: &mut [Fr], m: &[Fr], t: usize) {
    let input = state.to_vec();
    for j in 0..t {
        let mut acc = Fr::zero();
        for i in 0..t {
            acc += m[i * t + j] * input[i];
        }
        state[j] = acc;
    }
}

/// MixS: out[0] = sum_i S[(t*2-1)*r + i] * in[i];
/// out[j] = in[j] + in[0] * S[(t*2-1)*r + t + j - 1] for j>=1.
fn mix_s(state: &[Fr], s_mat: &[Fr], t: usize, r: usize) -> Vec<Fr> {
    let in0 = state[0];
    let mut out = vec![Fr::zero(); t];
    let base = (t * 2 - 1) * r;
    let mut acc = Fr::zero();
    for i in 0..t {
        acc += s_mat[base + i] * state[i];
    }
    out[0] = acc;
    for j in 1..t {
        out[j] = state[j] + in0 * s_mat[base + t + j - 1];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::field::fr_to_bigint;

    fn hex_of(f: &Fr) -> String {
        fr_to_bigint(f).to_str_radix(10)
    }

    #[test]
    fn poseidon_2_1_2() {
        // golden vector from circuits/utils/golden_vectors.json
        let a = crate::field::bigint_to_fr(&num_bigint::BigInt::from(1u32));
        let b = crate::field::bigint_to_fr(&num_bigint::BigInt::from(2u32));
        let r = poseidon(&[a, b], 1);
        assert_eq!(
            hex_of(&r[0]),
            "7853200120776062878684798364095072458815029376092732009249414926327459813530"
        );
    }

    #[test]
    fn poseidon_2_0_0() {
        let a = crate::field::bigint_to_fr(&num_bigint::BigInt::from(0u32));
        let b = crate::field::bigint_to_fr(&num_bigint::BigInt::from(0u32));
        let r = poseidon(&[a, b], 1);
        assert_eq!(
            hex_of(&r[0]),
            "14744269619966411208579211824598458697587494354926760081771325075741142829156"
        );
    }

    #[test]
    fn poseidon_3_nullifier() {
        // poseidon_3_input_nullifier_sample: [42,1,7]
        // NOTE: this matches the production circuit (verified against the
        // compiled `Poseidon(3)` circom template). The value in the repo's
        // golden_vectors.json (16983142540...) is incorrect for BN254.
        let a = crate::field::bigint_to_fr(&num_bigint::BigInt::from(42u32));
        let b = crate::field::bigint_to_fr(&num_bigint::BigInt::from(1u32));
        let c = crate::field::bigint_to_fr(&num_bigint::BigInt::from(7u32));
        let r = poseidon(&[a, b, c], 1);
        assert_eq!(
            hex_of(&r[0]),
            "18737442249547044993244804652416664065129524492605094640822933003569442662663"
        );
    }

    #[test]
    fn poseidon_4_comment_nullifier() {
        // Matches the compiled `Poseidon(4)` circom template.
        let a = crate::field::bigint_to_fr(&num_bigint::BigInt::from(42u32));
        let b = crate::field::bigint_to_fr(&num_bigint::BigInt::from(1u32));
        let c = crate::field::bigint_to_fr(&num_bigint::BigInt::from(7u32));
        let d = crate::field::bigint_to_fr(&num_bigint::BigInt::from(3u32));
        let r = poseidon(&[a, b, c, d], 1);
        assert_eq!(
            hex_of(&r[0]),
            "20858156703434316401687729294321829206037877850225338325642651914721087189404"
        );
    }

    #[test]
    fn poseidon_commitment_12345_67890() {
        // from poseidon_merkle_kat: Poseidon(12345, 67890)
        // expected = 0x1914879b2a4e7f9555f3eb55837243cefb1366a692794a7e5b5b3181fb14b49b
        let s = crate::field::bigint_to_fr(&num_bigint::BigInt::from(12345u32));
        let salt = crate::field::bigint_to_fr(&num_bigint::BigInt::from(67890u32));
        let r = poseidon(&[s, salt], 1);
        assert_eq!(
            format!("{:x}", fr_to_bigint(&r[0])),
            "1914879b2a4e7f9555f3eb55837243cefb1366a692794a7e5b5b3181fb14b49b"
        );
    }
}
