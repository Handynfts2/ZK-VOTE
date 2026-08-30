//! Nova IVC Recursive Vote Aggregator for ZK-VOTE
//!
//! Provides step circuit definition, IVC folding engine, proof compression,
//! and off-chain batch aggregation primitives for large-scale elections.

pub mod aggregator;
pub mod circuit;

use serde::{Deserialize, Serialize};

/// Running state vector for Nova IVC computation: z_i
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IvcState {
    /// Step index i (0..N)
    pub step_count: u64,
    /// Immutable Merkle tree root of identity commitments
    pub root: String,
    /// Total accumulated YES votes (voteChoice == 1)
    pub yes_votes: u64,
    /// Total accumulated NO votes (voteChoice == 0)
    pub no_votes: u64,
    /// Poseidon nullifier accumulator hash (hex 32-byte string)
    pub acc_nullifier_hash: String,
}

impl Default for IvcState {
    fn default() -> Self {
        Self {
            step_count: 0,
            root: String::from(
                "0x0000000000000000000000000000000000000000000000000000000000000000",
            ),
            yes_votes: 0,
            no_votes: 0,
            acc_nullifier_hash: String::from(
                "0x0000000000000000000000000000000000000000000000000000000000000000",
            ),
        }
    }
}

/// Private witness for a single voter's IVC step: \omega_i
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteWitness {
    /// Voter's private secret
    pub secret: String,
    /// Random salt for commitment
    pub salt: String,
    /// Merkle inclusion proof path elements (siblings)
    pub path_elements: Vec<String>,
    /// Merkle inclusion proof path indices (0=left, 1=right)
    pub path_indices: Vec<u8>,
    /// Vote selection: 0 = NO, 1 = YES
    pub vote_choice: u8,
    /// Domain-separated nullifier string
    pub nullifier: String,
    /// DAO ID
    pub dao_id: u64,
    /// Proposal ID
    pub proposal_id: u64,
}

/// Final recursive proof payload containing compressed proof and step outputs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecursiveProofPayload {
    /// Initial state z_0
    pub initial_state: IvcState,
    /// Final state z_N after N steps
    pub final_state: IvcState,
    /// Total number of folded votes
    pub num_votes: u64,
    /// Compressed Nova recursive proof bytes (hex string)
    pub proof_bytes: String,
    /// Execution proof timestamp
    pub timestamp: u64,
}

pub use aggregator::NovaAggregator;
pub use circuit::VoteStepCircuit;
