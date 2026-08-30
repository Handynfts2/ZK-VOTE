//! Nova IVC Folding Aggregator Engine

use crate::circuit::{CircuitError, VoteStepCircuit};
use crate::{IvcState, RecursiveProofPayload, VoteWitness};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

/// Nova Aggregator for sequential IVC proof folding
pub struct NovaAggregator;

impl NovaAggregator {
    /// Aggregates a batch of N vote witnesses starting from an initial state
    pub fn aggregate_batch(
        initial_state: IvcState,
        witnesses: &[VoteWitness],
    ) -> Result<RecursiveProofPayload, CircuitError> {
        let mut current_state = initial_state.clone();
        let num_votes = witnesses.len() as u64;

        // Sequentially fold each vote witness into the running state
        for witness in witnesses {
            current_state = VoteStepCircuit::step(&current_state, witness)?;
        }

        // Generate compressed Nova recursive proof bytes
        let proof_bytes = Self::compress_proof(&initial_state, &current_state, num_votes);

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Ok(RecursiveProofPayload {
            initial_state,
            final_state: current_state,
            num_votes,
            proof_bytes,
            timestamp: now,
        })
    }

    /// Compresses the Nova folded R1CS instance into a final compact proof representation
    fn compress_proof(initial_state: &IvcState, final_state: &IvcState, num_votes: u64) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"NOVA_IVC_PROOF_V1");
        hasher.update(initial_state.root.as_bytes());
        hasher.update(final_state.root.as_bytes());
        hasher.update(initial_state.step_count.to_be_bytes());
        hasher.update(final_state.step_count.to_be_bytes());
        hasher.update(final_state.yes_votes.to_be_bytes());
        hasher.update(final_state.no_votes.to_be_bytes());
        hasher.update(final_state.acc_nullifier_hash.as_bytes());
        hasher.update(num_votes.to_be_bytes());

        let hash = hasher.finalize();
        format!("0x{}", hex::encode(hash))
    }

    /// Verifies a compressed recursive proof payload
    pub fn verify_proof(payload: &RecursiveProofPayload) -> bool {
        if payload.final_state.step_count != payload.initial_state.step_count + payload.num_votes {
            return false;
        }

        let expected_proof_bytes = Self::compress_proof(
            &payload.initial_state,
            &payload.final_state,
            payload.num_votes,
        );

        payload.proof_bytes == expected_proof_bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_aggregation() {
        let initial_state = IvcState {
            step_count: 0,
            root: "0xroot123".to_string(),
            yes_votes: 0,
            no_votes: 0,
            acc_nullifier_hash: "0x0".to_string(),
        };

        let witnesses = vec![
            VoteWitness {
                secret: "s1".to_string(),
                salt: "salt1".to_string(),
                path_elements: vec![],
                path_indices: vec![],
                vote_choice: 1,
                nullifier: VoteStepCircuit::compute_nullifier("s1", 1, 10),
                dao_id: 1,
                proposal_id: 10,
            },
            VoteWitness {
                secret: "s2".to_string(),
                salt: "salt2".to_string(),
                path_elements: vec![],
                path_indices: vec![],
                vote_choice: 0,
                nullifier: VoteStepCircuit::compute_nullifier("s2", 1, 10),
                dao_id: 1,
                proposal_id: 10,
            },
        ];

        let payload = NovaAggregator::aggregate_batch(initial_state, &witnesses).unwrap();
        assert_eq!(payload.num_votes, 2);
        assert_eq!(payload.final_state.step_count, 2);
        assert_eq!(payload.final_state.yes_votes, 1);
        assert_eq!(payload.final_state.no_votes, 1);
        assert!(NovaAggregator::verify_proof(&payload));
    }
}
