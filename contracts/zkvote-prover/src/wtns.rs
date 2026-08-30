//! Parser for snarkjs `.wtns` witness files (binfile v1).

use crate::binfile::BinFile;
use crate::field::{decode_fr_canonical, Fr};

pub struct Witness {
    pub n_vars: u32,
    pub values: Vec<Fr>,
}

pub fn parse_wtns(buf: &[u8]) -> Result<Witness, String> {
    let bf = BinFile::parse(buf, b"wtns")?;
    let s1 = bf.section(1).ok_or("missing wtns header")?;
    let n8 = u32::from_le_bytes([s1[0], s1[1], s1[2], s1[3]]) as usize;
    // q occupies n8 bytes, then nWitness u32
    let n_vars = u32::from_le_bytes([s1[4 + n8], s1[5 + n8], s1[6 + n8], s1[7 + n8]]);

    let s2 = bf.section(2).ok_or("missing wtns data")?;
    let mut values = Vec::with_capacity(n_vars as usize);
    for i in 0..n_vars as usize {
        let off = i * n8;
        values.push(decode_fr_canonical(&s2[off..off + n8]));
    }
    Ok(Witness { n_vars, values })
}
