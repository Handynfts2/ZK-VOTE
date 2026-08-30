//! Diagnostic: validate the generated witness satisfies the compiled R1CS.

use std::path::PathBuf;
use zkvote_prover::r1cs::{check_witness, load_witness_decimal, parse_r1cs};

fn repo_root() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.pop();
    p
}

#[test]
fn witness_satisfies_r1cs() {
    let root = repo_root();
    let r1cs_path = root.join("circuits/build/vote.r1cs");
    let wit_path = root.join("circuits/test_witness_vote.json");
    if !r1cs_path.exists() || !wit_path.exists() {
        eprintln!("vote.r1cs or test_witness_vote.json missing; skipping diagnostic check");
        return;
    }

    let r1cs = parse_r1cs(&r1cs_path);
    eprintln!(
        "r1cs: n_vars={} n_public={} n_constraints={}",
        r1cs.n_vars, r1cs.n_public, r1cs.n_constraints
    );
    let witness = load_witness_decimal(&wit_path);
    eprintln!("witness len = {}", witness.len());

    let violations = check_witness(&r1cs, &witness);
    eprintln!("constraint violations = {}", violations);
    assert_eq!(violations, 0, "witness does not satisfy R1CS");
}

#[test]
fn comment_r1cs_parses() {
    let root = repo_root();
    let r1cs_path = root.join("circuits/build/comment.r1cs");
    if !r1cs_path.exists() {
        eprintln!("comment.r1cs missing; skipping diagnostic check");
        return;
    }
    let r1cs = parse_r1cs(&r1cs_path);
    eprintln!(
        "comment r1cs: n_vars={} n_public={} n_constraints={}",
        r1cs.n_vars, r1cs.n_public, r1cs.n_constraints
    );
    assert!(r1cs.n_constraints > 0, "comment R1CS has no constraints");
}
