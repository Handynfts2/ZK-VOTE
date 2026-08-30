//! Conversions between snarkjs's on-disk field representation (little-endian
//! Montgomery form, R = 2^256) and `ark_bn254` field elements.
//!
//! snarkjs stores every field element as 32 bytes little-endian in *Montgomery
//! residue* form: `m = v * R mod q` where `R = 2^256` and `q` is the field
//! prime. To obtain the canonical integer `v` we compute
//! `v = m * R^{-1} mod q`.

pub use ark_bn254::{Fq, Fr};
use ark_ff::PrimeField;
use num_bigint::{BigInt, Sign};
use num_traits::{One, ToPrimitive, Zero};

pub const SCALAR_MODULUS: &str =
    "21888242871839275222246405745257275088548364400416034343698204186575808495617";
pub const BASE_MODULUS: &str =
    "21888242871839275222246405745257275088696311157297823662689037894645226208583";

fn scalar_q() -> BigInt {
    BigInt::parse_bytes(SCALAR_MODULUS.as_bytes(), 10).unwrap()
}
fn base_q() -> BigInt {
    BigInt::parse_bytes(BASE_MODULUS.as_bytes(), 10).unwrap()
}

/// R = 2^256 mod q (the Montgomery radix used by ffjavascript for 32-byte fields).
fn r_mod_q(q: &BigInt) -> BigInt {
    let mut r = BigInt::one();
    for _ in 0..256u32 {
        r = (&r * 2u32) % q;
    }
    r
}

fn modinv(a: &BigInt, m: &BigInt) -> BigInt {
    let mut t = BigInt::zero();
    let mut newt = BigInt::one();
    let mut r = m.clone();
    let mut newr = a % m;
    if newr < BigInt::zero() {
        newr += m;
    }
    while newr != BigInt::zero() {
        let q = &r / &newr;
        let (t_old, newt_old) = (t.clone(), newt.clone());
        t = newt_old.clone();
        newt = t_old - &q * newt_old;
        let (r_old, newr_old) = (r.clone(), newr.clone());
        r = newr_old.clone();
        newr = r_old - &q * newr_old;
    }
    if t < BigInt::zero() {
        t += m;
    }
    t
}

fn mont_to_int(bytes_le: &[u8], q: &BigInt) -> BigInt {
    mont_to_int_bits(bytes_le, q, 256)
}

/// Decode a 32-byte LE Montgomery field element using radix `R = 2^bits`.
/// snarkjs stores scalar-field elements (witness, zkey ccoefs) with `bits = 248`
/// but base-field elements (G1/G2 point coordinates) with `bits = 256`.
fn mont_to_int_bits(bytes_le: &[u8], q: &BigInt, bits: u32) -> BigInt {
    debug_assert!(bytes_le.len() == 32);
    let mut m = BigInt::zero();
    for &b in bytes_le.iter().rev() {
        m = (&m * 256) + BigInt::from(b);
    }
    let rinv = inverse_radix(bits, q);
    (&m * rinv) % q
}

/// Precomputed inverse Montgomery radices `2^-bits mod q` for the radices we
/// use (256 for base/scalar on-disk, 248 and 504 for snarkjs scalar quirks).
/// Caching avoids an extended-Euclid `modinv` on every element decode, which
/// matters in debug builds where `num_bigint` is slow.
fn inverse_radix(bits: u32, q: &BigInt) -> BigInt {
    use std::sync::OnceLock;
    static INV256_S: OnceLock<BigInt> = OnceLock::new();
    static INV256_B: OnceLock<BigInt> = OnceLock::new();
    static INV248: OnceLock<BigInt> = OnceLock::new();
    static INV504: OnceLock<BigInt> = OnceLock::new();
    let r = pow2_mod(bits, q);
    let inv = modinv(&r, q);
    match (bits, q == &scalar_q()) {
        (256, true) => INV256_S.get_or_init(|| inv),
        (256, false) => INV256_B.get_or_init(|| inv),
        (248, _) => INV248.get_or_init(|| inv),
        (504, _) => INV504.get_or_init(|| inv),
        _ => &inv,
    }
    .clone()
}

fn pow2_mod(bits: u32, q: &BigInt) -> BigInt {
    let mut r = BigInt::one();
    for _ in 0..bits {
        r = (&r * 2u32) % q;
    }
    r
}

fn int_to_mont(v: &BigInt, q: &BigInt) -> [u8; 32] {
    let r = r_mod_q(q);
    let mut m = (v % q) * &r % q;
    if m < BigInt::zero() {
        m += q;
    }
    let mut out = [0u8; 32];
    for slot in &mut out {
        *slot = u8_of(&m);
        m >>= 8;
    }
    out
}

fn u8_of(b: &BigInt) -> u8 {
    let rem = b.clone() % BigInt::from(256u32);
    let r = if rem < BigInt::zero() {
        rem + BigInt::from(256u32)
    } else {
        rem
    };
    r.to_u8().unwrap()
}

pub fn bigint_to_fr(v: &BigInt) -> Fr {
    let mut be = [0u8; 32];
    let mut tmp = if v.sign() == Sign::Minus {
        v + &scalar_q()
    } else {
        v.clone()
    };
    for i in (0..32).rev() {
        be[i] = u8_of(&tmp);
        tmp >>= 8;
    }
    Fr::from_be_bytes_mod_order(&be)
}

fn bigint_to_fq(v: &BigInt) -> Fq {
    let mut be = [0u8; 32];
    let mut tmp = if v.sign() == Sign::Minus {
        v + &base_q()
    } else {
        v.clone()
    };
    for i in (0..32).rev() {
        be[i] = u8_of(&tmp);
        tmp >>= 8;
    }
    Fq::from_be_bytes_mod_order(&be)
}

fn bigint_from_limbs(limbs: &[u64; 4]) -> BigInt {
    let mut acc = BigInt::zero();
    for &l in limbs.iter().rev() {
        acc = (acc << 64) + BigInt::from(l);
    }
    acc
}

/// Decode a 32-byte little-endian Montgomery field element (scalar field) into `Fr`.
pub fn decode_fr(bytes_le: &[u8]) -> Fr {
    let v = mont_to_int(bytes_le, &scalar_q());
    bigint_to_fr(&v)
}

/// Decode a 32-byte LE *snarkjs scalar-field Montgomery* element (`R = 2^248`)
/// into `Fr`. This is how snarkjs stores the zkey linear-combination
/// coefficients (`ccoefs`) and the witness.
pub fn decode_fr_snarkmont(bytes_le: &[u8]) -> Fr {
    let v = mont_to_int_bits(bytes_le, &scalar_q(), 248);
    bigint_to_fr(&v)
}

/// Decode a zkey `ccoef` linear-combination coefficient into `Fr`.
///
/// snarkjs writes the coefficient in a *double* Montgomery residue: the
/// underlying value is already in 2^256 Montgomery (ark's `R`), and snarkjs's
/// on-disk writer then applies its own 2^248 Montgomery residue on top, so the
/// stored bytes equal `v * 2^504 mod q`. The canonical integer is therefore
/// recovered by dividing by `R = 2^504`.
///
/// The most-significant bit of the buffer (bit 255) is a **sign flag**: when
/// set the coefficient is negative and the magnitude must be negated. snarkjs
/// stores every `ccoef` this way, so without this handling all negative
/// coefficients (the large majority of non-linear constraint terms) decode as
/// the wrong (huge positive) value, silently corrupting the proving key.
pub fn decode_fr_zk_coef(bytes_le: &[u8]) -> Fr {
    let mut buf = [0u8; 32];
    buf.copy_from_slice(bytes_le);
    let sign = buf[31] & 0x80;
    buf[31] &= 0x7f;
    let v = mont_to_int_bits(&buf, &scalar_q(), 504);
    let f = bigint_to_fr(&v);
    if sign != 0 {
        -f
    } else {
        f
    }
}

/// Decode a 32-byte little-endian *canonical* (regular, non-Montgomery) field
/// element into `Fr`. The R1CS file stores linear-combination coefficients in
/// this form (snarkjs reads them via `fromRprLE`); the zkey stores them in
/// Montgomery form (see [`decode_fr`]).
pub fn decode_fr_canonical(bytes_le: &[u8]) -> Fr {
    let mut v = BigInt::zero();
    for &b in bytes_le.iter().rev() {
        v = (&v * 256) + BigInt::from(b);
    }
    bigint_to_fr(&v)
}

/// Generic decode with an explicit Montgomery radix `bits` (`0` = canonical).
pub fn decode_fr_bits(bytes_le: &[u8], bits: u32) -> Fr {
    let v = mont_to_int_bits(bytes_le, &scalar_q(), bits);
    bigint_to_fr(&v)
}

/// Decode a 32-byte little-endian *canonical* (regular, non-Montgomery) base-field
/// element into `Fq`. Some zkey sections (notably the `C` and `H` point tables)
/// store points in this form rather than Montgomery form.
pub fn decode_fq_canonical(bytes_le: &[u8]) -> Fq {
    let mut v = BigInt::zero();
    for &b in bytes_le.iter().rev() {
        v = (&v * 256) + BigInt::from(b);
    }
    bigint_to_fq(&v)
}

/// Decode a 32-byte little-endian Montgomery field element (base field) into `Fq`.
pub fn decode_fq(bytes_le: &[u8]) -> Fq {
    let v = mont_to_int(bytes_le, &base_q());
    bigint_to_fq(&v)
}

/// Encode an `Fr` into snarkjs's 32-byte little-endian Montgomery form.
pub fn encode_fr(x: &Fr) -> [u8; 32] {
    let v = fr_to_bigint(x);
    int_to_mont(&v, &scalar_q())
}

/// Encode an `Fq` into snarkjs's 32-byte little-endian Montgomery form.
pub fn encode_fq(x: &Fq) -> [u8; 32] {
    let v = fq_to_bigint(x);
    int_to_mont(&v, &base_q())
}

pub fn fr_to_bigint(x: &Fr) -> BigInt {
    let limbs = x.into_bigint();
    bigint_from_limbs(&limbs.0)
}

pub fn fq_to_bigint(x: &Fq) -> BigInt {
    let limbs = x.into_bigint();
    bigint_from_limbs(&limbs.0)
}

pub fn read_fr_int(bytes_le: &[u8]) -> BigInt {
    mont_to_int(bytes_le, &scalar_q())
}

pub fn read_fq_int(bytes_le: &[u8]) -> BigInt {
    mont_to_int(bytes_le, &base_q())
}

pub fn fr_modulus() -> BigInt {
    scalar_q()
}

/// Parse a canonical decimal field element (as produced by circom's witness
/// JSON) into `Fr`.
pub fn fr_from_decimal(s: &str) -> Fr {
    let v = BigInt::parse_bytes(s.trim().as_bytes(), 10).unwrap();
    bigint_to_fr(&v)
}

/// Parse a canonical decimal base-field element into `Fq`.
pub fn fq_from_decimal(s: &str) -> Fq {
    let v = BigInt::parse_bytes(s.trim().as_bytes(), 10).unwrap();
    bigint_to_fq(&v)
}

/// Decode a 64-byte snarkjs G1 point (x || y, each 32-byte LE Montgomery) into `G1Affine`.
/// snarkjs encodes the point-at-infinity as the (0, 0) sentinel.
pub fn read_g1(bytes: &[u8]) -> G1Affine {
    let x = decode_fq(&bytes[0..32]);
    let y = decode_fq(&bytes[32..64]);
    if x.is_zero() && y.is_zero() {
        return G1Affine::identity();
    }
    G1Affine::new(x, y)
}

/// Decode a 128-byte snarkjs G2 point ([x.c0, x.c1, y.c0, y.c1], each 32-byte LE
/// Montgomery) into `G2Affine`. snarkjs encodes the point-at-infinity as (0,0,0,0).
pub fn read_g2(bytes: &[u8]) -> G2Affine {
    let xc0 = decode_fq(&bytes[0..32]);
    let xc1 = decode_fq(&bytes[32..64]);
    let yc0 = decode_fq(&bytes[64..96]);
    let yc1 = decode_fq(&bytes[96..128]);
    if xc0.is_zero() && xc1.is_zero() && yc0.is_zero() && yc1.is_zero() {
        return G2Affine::identity();
    }
    G2Affine::new(Fq2::new(xc0, xc1), Fq2::new(yc0, yc1))
}

pub use ark_bn254::{Fq2, G1Affine, G2Affine};
