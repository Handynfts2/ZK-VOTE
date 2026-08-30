//! Helper that derives a self-consistent vote-circuit input (commitment,
//! nullifier, Merkle root, path) from a known secret using the crate's
//! circomlib-compatible Poseidon, and prints it as JSON. The resulting `root`
//! satisfies the circuit constraints by construction (leaf at Merkle index 0).

use ark_ff::Zero;
use num_bigint::BigInt;
use zkvote_prover::field::{bigint_to_fr, fr_to_bigint, Fr};
use zkvote_prover::poseidon::poseidon;

fn dec(x: &Fr) -> String {
    fr_to_bigint(x).to_str_radix(10)
}

fn ph(inputs: &[Fr]) -> Fr {
    poseidon(inputs, 1)[0]
}

fn main() {
    let secret = bigint_to_fr(&BigInt::from(123456789u64));
    let salt = bigint_to_fr(&BigInt::from(987654321u64));
    let dao_id = bigint_to_fr(&BigInt::from(42u64));
    let proposal_id = bigint_to_fr(&BigInt::from(7u64));
    let vote_choice = bigint_to_fr(&BigInt::from(1u64));

    let commitment = ph(&[secret, salt]);

    // zero hashes for an empty Merkle subtree of height h
    let mut zeros: Vec<Fr> = vec![Fr::zero()];
    for h in 1..=18 {
        let prev = zeros[h - 1];
        zeros.push(ph(&[prev, prev]));
    }

    // Merkle root of leaf `commitment` at index 0 (all path indices 0)
    let mut cur = commitment;
    let mut path_elements = Vec::new();
    for i in 0..18u32 {
        let sibling = zeros[(17 - i) as usize];
        path_elements.push(dec(&sibling));
        cur = ph(&[cur, sibling]);
    }
    let root = cur;
    let nullifier = ph(&[secret, dao_id, proposal_id]);

    let path_indices: Vec<u8> = vec![0; 18];
    let input = serde_json::json!({
        "root": dec(&root),
        "nullifier": dec(&nullifier),
        "daoId": dec(&dao_id),
        "proposalId": dec(&proposal_id),
        "voteChoice": dec(&vote_choice),
        "secret": dec(&secret),
        "salt": dec(&salt),
        "pathElements": path_elements,
        "pathIndices": path_indices,
    });
    println!("{}", serde_json::to_string_pretty(&input).unwrap());
}
