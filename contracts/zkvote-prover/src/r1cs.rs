//! Minimal R1CS parser + constraint checker used to validate a generated
//! witness against the compiled circuit, independent of snarkjs.

use crate::field::{decode_fr_canonical, fr_from_decimal, Fr};
use ark_ff::Zero;
use std::path::Path;

#[allow(clippy::type_complexity)]
pub struct R1cs {
    pub n_vars: usize,
    pub n_public: usize,
    pub n_constraints: usize,
    /// Each constraint has (A, B, C) linear combinations: vectors of
    /// `(signal_index, coefficient)`.
    pub constraints: Vec<(Vec<(usize, Fr)>, Vec<(usize, Fr)>, Vec<(usize, Fr)>)>,
}

struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Cursor { buf, pos: 0 }
    }
    fn u32(&mut self) -> u32 {
        let v = u32::from_le_bytes(self.buf[self.pos..self.pos + 4].try_into().unwrap());
        self.pos += 4;
        v
    }
    fn u64(&mut self) -> u64 {
        let v = u64::from_le_bytes(self.buf[self.pos..self.pos + 8].try_into().unwrap());
        self.pos += 8;
        v
    }
    fn bytes(&mut self, n: usize) -> &'a [u8] {
        let v = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        v
    }
}

pub fn parse_r1cs(path: &Path) -> R1cs {
    let data = std::fs::read(path).expect("read r1cs");
    assert_eq!(&data[0..4], b"r1cs", "not an r1cs file");
    let mut c = Cursor::new(&data);
    c.bytes(4); // skip magic
    let _version = c.u32();
    let n_sections = c.u32();

    let mut header: Option<(usize, usize, usize)> = None;
    let mut constraints_bytes: Option<&[u8]> = None;

    eprintln!("n_sections={}", n_sections);
    for _ in 0..n_sections {
        let id = c.u32();
        let size = c.u64() as usize;
        let section = c.bytes(size);
        if id == 1 {
            let mut h = Cursor::new(section);
            let n8 = h.u32() as usize;
            let prime = h.bytes(n8);
            assert_eq!(prime.len(), 32);
            let _n_vars = h.u32();
            let _n_outputs = h.u32();
            let n_pub = h.u32();
            let _n_prv = h.u32();
            let _n_labels = h.u64();
            let n_constraints = h.u32();
            let n_vars = _n_vars as usize;
            header = Some((n_vars, n_pub as usize, n_constraints as usize));
        } else if id == 2 {
            constraints_bytes = Some(section);
        }
    }

    let (n_vars, n_public, n_constraints) = header.expect("missing r1cs header");
    let cb = constraints_bytes.expect("missing constraints section");
    let mut cc = Cursor::new(cb);

    let mut constraints = Vec::with_capacity(n_constraints);
    for _ in 0..n_constraints {
        let a = read_lc(&mut cc);
        let b = read_lc(&mut cc);
        let c = read_lc(&mut cc);
        constraints.push((a, b, c));
    }

    R1cs {
        n_vars,
        n_public,
        n_constraints,
        constraints,
    }
}

fn read_lc(c: &mut Cursor) -> Vec<(usize, Fr)> {
    let n = c.u32() as usize;
    let mut lc = Vec::with_capacity(n);
    for _ in 0..n {
        let idx = c.u32() as usize;
        let val_bytes = c.bytes(32);
        let val = decode_fr_canonical(val_bytes);
        lc.push((idx, val));
    }
    lc
}

/// Load a circom witness JSON (array of decimal strings) into `Fr` values.
pub fn load_witness_decimal(path: &Path) -> Vec<Fr> {
    let s = std::fs::read_to_string(path).expect("read witness");
    let arr: serde_json::Value = serde_json::from_str(&s).expect("parse witness json");
    let arr = arr.as_array().expect("witness must be array");
    arr.iter()
        .map(|v| fr_from_decimal(v.as_str().expect("witness entry must be string")))
        .collect()
}

/// Check every R1CS constraint `A·w ∘ B·w == C·w`. Returns the number of
/// violated constraints (0 means the witness is valid).
pub fn check_witness(r1cs: &R1cs, witness: &[Fr]) -> usize {
    assert_eq!(witness.len(), r1cs.n_vars, "witness length mismatch");
    let mut violations = 0usize;
    for (i, (a, b, c)) in r1cs.constraints.iter().enumerate() {
        let mut av = Fr::zero();
        let mut bv = Fr::zero();
        let mut cv = Fr::zero();
        for (idx, coeff) in a {
            av += *coeff * witness[*idx];
        }
        for (idx, coeff) in b {
            bv += *coeff * witness[*idx];
        }
        for (idx, coeff) in c {
            cv += *coeff * witness[*idx];
        }
        if av * bv != cv {
            violations += 1;
            if violations <= 10 {
                eprintln!("constraint {} violated", i);
            }
        }
    }
    violations
}
