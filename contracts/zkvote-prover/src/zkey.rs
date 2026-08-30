//! Parser for snarkjs Groth16 `.zkey` files (binfile v1, protocol id 1).

use crate::binfile::BinFile;
use crate::field::{decode_fr_zk_coef, read_g1, read_g2, Fr, G1Affine, G2Affine};
use ark_ff::Zero;
use num_bigint::BigInt;

#[derive(Debug)]
pub struct Coef {
    pub matrix: u8, // 0 = A, 1 = B, 2 = C
    pub constraint: u32,
    pub signal: u32,
    pub value: Fr,
}

#[derive(Debug)]
pub struct ProvingKey {
    pub n_vars: u32,
    pub n_public: u32,
    pub domain_size: u32,
    pub r_mod: BigInt,

    pub vk_alpha_1: G1Affine,
    pub vk_beta_1: G1Affine,
    pub vk_beta_2: G2Affine,
    pub vk_gamma_2: G2Affine,
    pub vk_delta_1: G1Affine,
    pub vk_delta_2: G2Affine,

    pub ic: Vec<G1Affine>,
    pub a: Vec<G1Affine>,
    pub b1: Vec<G1Affine>,
    pub b2: Vec<G2Affine>,
    pub c: Vec<G1Affine>,
    pub h: Vec<G1Affine>,

    pub coefs: Vec<Coef>,
}

fn read_u32(b: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]])
}

#[allow(dead_code)]
fn read_u64(b: &[u8], off: usize) -> u64 {
    u64::from_le_bytes([
        b[off],
        b[off + 1],
        b[off + 2],
        b[off + 3],
        b[off + 4],
        b[off + 5],
        b[off + 6],
        b[off + 7],
    ])
}

fn read_g1_slice(b: &[u8]) -> G1Affine {
    read_g1(&b[0..64])
}
#[allow(dead_code)]
fn read_g1_canonical_slice(b: &[u8]) -> G1Affine {
    use crate::field::decode_fq_canonical;
    let x = decode_fq_canonical(&b[0..32]);
    let y = decode_fq_canonical(&b[32..64]);
    if x.is_zero() && y.is_zero() {
        return G1Affine::identity();
    }
    G1Affine::new(x, y)
}
fn read_g2_slice(b: &[u8]) -> G2Affine {
    read_g2(&b[0..128])
}

pub fn parse_zkey(buf: &[u8]) -> Result<ProvingKey, String> {
    let bf = BinFile::parse(buf, b"zkey")?;

    // Section 1: protocol id
    let s1 = bf.section(1).ok_or("missing protocol section")?;
    let protocol_id = read_u32(s1, 0);
    if protocol_id != 1 {
        return Err(format!("unsupported protocol id {}", protocol_id));
    }

    // Section 2: groth16 header
    let s2 = bf.section(2).ok_or("missing header section")?;
    let n8q = read_u32(s2, 0) as usize;
    let _q = read_bigint_le(&s2[4..4 + n8q]);
    let off_r = 4 + n8q;
    let n8r = read_u32(s2, off_r) as usize;
    let r_mod = read_bigint_le(&s2[off_r + 4..off_r + 4 + n8r]);
    let off_vars = off_r + 4 + n8r;
    let n_vars = read_u32(s2, off_vars);
    let n_public = read_u32(s2, off_vars + 4);
    let domain_size = read_u32(s2, off_vars + 8);
    let mut p = off_vars + 12;
    let vk_alpha_1 = read_g1_slice(&s2[p..]);
    p += 64;
    let vk_beta_1 = read_g1_slice(&s2[p..]);
    p += 64;
    let vk_beta_2 = read_g2_slice(&s2[p..]);
    p += 128;
    let vk_gamma_2 = read_g2_slice(&s2[p..]);
    p += 128;
    let vk_delta_1 = read_g1_slice(&s2[p..]);
    p += 64;
    let vk_delta_2 = read_g2_slice(&s2[p..]);

    // Section 3: IC (nPublic + 1 G1)
    let s3 = bf.section(3).ok_or("missing IC section")?;
    let mut ic = Vec::with_capacity(n_public as usize + 1);
    for i in 0..(n_public as usize + 1) {
        ic.push(read_g1_slice(&s3[i * 64..]));
    }

    // Section 4: ccoefs
    let s4 = bf.section(4).ok_or("missing coeffs section")?;
    let n_coef = read_u32(s4, 0);
    let s_coef = 12 + n8r; // m(4) + c(4) + s(4) + coef(n8r)
    let mut coefs = Vec::with_capacity(n_coef as usize);
    for i in 0..n_coef as usize {
        let base = 4 + i * s_coef;
        let m = read_u32(s4, base);
        let c = read_u32(s4, base + 4);
        let s = read_u32(s4, base + 8);
        let raw_coef = &s4[base + 12..base + 12 + n8r];
        let coef_val = decode_fr_zk_coef(raw_coef);
        coefs.push(Coef {
            matrix: m as u8,
            constraint: c,
            signal: s,
            value: coef_val,
        });
    }

    // Section 5: A (nVars G1)
    let s5 = bf.section(5).ok_or("missing A section")?;
    let a = read_g1_vec(s5, n_vars as usize);
    // Section 6: B1 (nVars G1)
    let s6 = bf.section(6).ok_or("missing B1 section")?;
    let b1 = read_g1_vec(s6, n_vars as usize);
    // Section 7: B2 (nVars G2)
    let s7 = bf.section(7).ok_or("missing B2 section")?;
    let b2 = read_g2_vec(s7, n_vars as usize);
    // Section 8: C (nVars - nPublic - 1 G1)
    let s8 = bf.section(8).ok_or("missing C section")?;
    let c = read_g1_vec(s8, n_vars as usize - n_public as usize - 1);
    // Section 9: H (domainSize G1)
    let s9 = bf.section(9).ok_or("missing H section")?;
    let h = read_g1_vec(s9, domain_size as usize);

    Ok(ProvingKey {
        n_vars,
        n_public,
        domain_size,
        r_mod,
        vk_alpha_1,
        vk_beta_1,
        vk_beta_2,
        vk_gamma_2,
        vk_delta_1,
        vk_delta_2,
        ic,
        a,
        b1,
        b2,
        c,
        h,
        coefs,
    })
}

fn read_bigint_le(b: &[u8]) -> BigInt {
    let mut acc = BigInt::from(0);
    for &byte in b.iter().rev() {
        acc = (acc << 8) + BigInt::from(byte);
    }
    acc
}

#[allow(dead_code)]
fn read_fr_from(b: &[u8]) -> Fr {
    use crate::field::decode_fr;
    decode_fr(b)
}

fn read_g1_vec(b: &[u8], n: usize) -> Vec<G1Affine> {
    let mut v = Vec::with_capacity(n);
    for i in 0..n {
        v.push(read_g1_slice(&b[i * 64..]));
    }
    v
}
fn read_g2_vec(b: &[u8], n: usize) -> Vec<G2Affine> {
    let mut v = Vec::with_capacity(n);
    for i in 0..n {
        v.push(read_g2_slice(&b[i * 128..]));
    }
    v
}
#[allow(dead_code)]
fn read_g1_vec_canonical(b: &[u8], n: usize) -> Vec<G1Affine> {
    let mut v = Vec::with_capacity(n);
    for i in 0..n {
        v.push(read_g1_canonical_slice(&b[i * 64..]));
    }
    v
}
