//! # Audit-Friendly Proof Serialization Format (ZKV1)
//!
//! Standardizes the byte layout used to move a Groth16 proof between
//! circom/snarkjs, the backend relayer, and this contract, so the format is
//! explicit, versioned, and independently auditable instead of being implied
//! by ad-hoc parsing code spread across the stack.
//!
//! ## Wire format
//!
//! ```text
//! [ version (1B) | curve_id (1B) | A_x (32B) | A_y (32B)
//!   | B_x1 (32B) | B_x2 (32B) | B_y1 (32B) | B_y2 (32B)
//!   | C_x (32B) | C_y (32B) ]
//! ```
//!
//! * `version` — format version, currently `1` (`PROOF_FORMAT_VERSION`).
//!   Future incompatible layout changes MUST bump this byte so old and new
//!   decoders can safely reject data they don't understand.
//! * `curve_id` — `0x00` = BN254, `0x01` = BLS12-381 (mirrors [`CurveId`]).
//! * All field-element coordinates are **big-endian**, matching the
//!   existing `hexToBytes` / Soroban `ScVal` conventions used by the
//!   backend (`backend/src/services/stellar.ts::proofToScVal`).
//! * `B` is encoded as `x1 || x2 || y1 || y2` (the usual G2 affine
//!   coordinate order used by snarkjs/circom for BN254/BLS12-381 towers).
//!
//! Total length for BN254 (G1 = 64B, G2 = 128B): `2 + 64 + 128 + 64 = 258`
//! bytes. The same layout is reused for BLS12-381 proofs; only the
//! `curve_id` byte differs (point sizes are curve-specific and validated by
//! `Proof`/`ProofBls381`'s fixed-size `BytesN` fields upstream of this
//! module, so this module deals with the canonical BN254 258-byte form,
//! which is what the current single Soroban `Proof` type uses).
//!
//! This module is intentionally dependency-free (only `soroban_sdk`
//! primitives) so it can be exercised with plain round-trip tests and used
//! as the canonical reference for the TypeScript mirror in
//! `backend/src/services/proofSerialization.ts`.

use soroban_sdk::{Bytes, BytesN, Env};

use crate::{CurveId, Groth16Error, Proof};

/// Current wire-format version. Bump on any incompatible layout change.
pub const PROOF_FORMAT_VERSION: u8 = 1;

/// Length in bytes of a G1 point encoding (x || y, 32B each).
const G1_LEN: usize = 64;
/// Length in bytes of a G2 point encoding (x1 || x2 || y1 || y2, 32B each).
const G2_LEN: usize = 128;
/// Total length of a serialized BN254 ZKV1 proof:
/// 1 (version) + 1 (curve_id) + 64 (A) + 128 (B) + 64 (C).
pub const SERIALIZED_PROOF_LEN: usize = 1 + 1 + G1_LEN + G2_LEN + G1_LEN;

fn curve_id_to_byte(curve: CurveId) -> u8 {
    match curve {
        CurveId::Bn254 => 0,
        CurveId::Bls12381 => 1,
    }
}

fn curve_id_from_byte(byte: u8) -> Result<CurveId, Groth16Error> {
    match byte {
        0 => Ok(CurveId::Bn254),
        1 => Ok(CurveId::Bls12381),
        _ => Err(Groth16Error::InvalidProofFormat),
    }
}

/// Serialize a BN254 `Proof` into the versioned ZKV1 byte format.
///
/// Returns exactly [`SERIALIZED_PROOF_LEN`] bytes:
/// `version || curve_id || A || B || C`.
pub fn serialize_proof(env: &Env, proof: &Proof, curve: CurveId) -> Bytes {
    let mut out = Bytes::new(env);
    out.push_back(PROOF_FORMAT_VERSION);
    out.push_back(curve_id_to_byte(curve));
    out.append(&Bytes::from(&proof.a));
    out.append(&Bytes::from(&proof.b));
    out.append(&Bytes::from(&proof.c));
    out
}

/// Deserialize a ZKV1-encoded proof back into a `(Proof, CurveId)` pair.
///
/// Validates the version byte, the curve id byte, and the total length
/// before slicing out the fixed-size point components. This is the
/// counterpart to [`serialize_proof`] and is what a verifier/auditor tool
/// should use to parse an externally supplied proof blob.
pub fn deserialize_proof(_env: &Env, bytes: &Bytes) -> Result<(Proof, CurveId), Groth16Error> {
    if bytes.len() as usize != SERIALIZED_PROOF_LEN {
        return Err(Groth16Error::InvalidProofFormat);
    }

    let version = bytes.get(0).ok_or(Groth16Error::InvalidProofFormat)?;
    if version != PROOF_FORMAT_VERSION {
        return Err(Groth16Error::InvalidProofFormat);
    }

    let curve_byte = bytes.get(1).ok_or(Groth16Error::InvalidProofFormat)?;
    let curve = curve_id_from_byte(curve_byte)?;

    let a_start: u32 = 2;
    let b_start: u32 = a_start + G1_LEN as u32;
    let c_start: u32 = b_start + G2_LEN as u32;
    let end: u32 = c_start + G1_LEN as u32;

    let a_bytes = bytes.slice(a_start..b_start);
    let b_bytes = bytes.slice(b_start..c_start);
    let c_bytes = bytes.slice(c_start..end);

    let a: BytesN<64> = a_bytes
        .try_into()
        .map_err(|_| Groth16Error::InvalidProofFormat)?;
    let b: BytesN<128> = b_bytes
        .try_into()
        .map_err(|_| Groth16Error::InvalidProofFormat)?;
    let c: BytesN<64> = c_bytes
        .try_into()
        .map_err(|_| Groth16Error::InvalidProofFormat)?;

    Ok((Proof { a, b, c }, curve))
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    fn sample_proof(env: &Env, seed: u8) -> Proof {
        let mut a = [0u8; 64];
        let mut b = [0u8; 128];
        let mut c = [0u8; 64];
        for (i, byte) in a.iter_mut().enumerate() {
            *byte = seed.wrapping_add(i as u8).wrapping_add(1);
        }
        for (i, byte) in b.iter_mut().enumerate() {
            *byte = seed.wrapping_add(i as u8).wrapping_add(2);
        }
        for (i, byte) in c.iter_mut().enumerate() {
            *byte = seed.wrapping_add(i as u8).wrapping_add(3);
        }
        Proof {
            a: BytesN::from_array(env, &a),
            b: BytesN::from_array(env, &b),
            c: BytesN::from_array(env, &c),
        }
    }

    #[test]
    fn round_trip_bn254() {
        let env = Env::default();
        let proof = sample_proof(&env, 7);
        let bytes = serialize_proof(&env, &proof, CurveId::Bn254);
        assert_eq!(bytes.len() as usize, SERIALIZED_PROOF_LEN);
        assert_eq!(bytes.get(0), Some(PROOF_FORMAT_VERSION));
        assert_eq!(bytes.get(1), Some(0u8));

        let (decoded, curve) = deserialize_proof(&env, &bytes).expect("valid proof decodes");
        assert_eq!(curve, CurveId::Bn254);
        assert_eq!(decoded.a, proof.a);
        assert_eq!(decoded.b, proof.b);
        assert_eq!(decoded.c, proof.c);
    }

    #[test]
    fn round_trip_bls12381_curve_id() {
        let env = Env::default();
        let proof = sample_proof(&env, 42);
        let bytes = serialize_proof(&env, &proof, CurveId::Bls12381);
        assert_eq!(bytes.get(1), Some(1u8));

        let (decoded, curve) = deserialize_proof(&env, &bytes).expect("valid proof decodes");
        assert_eq!(curve, CurveId::Bls12381);
        assert_eq!(decoded.a, proof.a);
    }

    #[test]
    fn rejects_wrong_version() {
        let env = Env::default();
        let proof = sample_proof(&env, 1);
        let mut bytes = serialize_proof(&env, &proof, CurveId::Bn254);
        bytes.set(0, PROOF_FORMAT_VERSION + 1);
        let result = deserialize_proof(&env, &bytes);
        assert_eq!(result.err(), Some(Groth16Error::InvalidProofFormat));
    }

    #[test]
    fn rejects_unknown_curve_id() {
        let env = Env::default();
        let proof = sample_proof(&env, 1);
        let mut bytes = serialize_proof(&env, &proof, CurveId::Bn254);
        bytes.set(1, 0xFF);
        let result = deserialize_proof(&env, &bytes);
        assert_eq!(result.err(), Some(Groth16Error::InvalidProofFormat));
    }

    #[test]
    fn rejects_wrong_length() {
        let env = Env::default();
        let proof = sample_proof(&env, 1);
        let bytes = serialize_proof(&env, &proof, CurveId::Bn254);
        let truncated = bytes.slice(0..(bytes.len() - 1));
        let result = deserialize_proof(&env, &truncated);
        assert_eq!(result.err(), Some(Groth16Error::InvalidProofFormat));
    }

    #[test]
    fn distinct_proofs_serialize_distinctly() {
        let env = Env::default();
        let p1 = sample_proof(&env, 1);
        let p2 = sample_proof(&env, 2);
        let b1 = serialize_proof(&env, &p1, CurveId::Bn254);
        let b2 = serialize_proof(&env, &p2, CurveId::Bn254);
        assert_ne!(b1, b2);
    }
}
