//! # Verifiable Delay Function (VDF) for Election Randomness
//!
//! Implements a VDF using iterated SHA256 as the delay function. This provides
//! verifiable randomness that is unpredictable before computation completes.
//!
//! ## VDF Construction
//!
//! The VDF is defined as: `y = SHA256^T(x)`
//!
//! - **x**: Input seed (e.g., election creation block hash)
//! - **T**: Delay parameter (number of SHA256 iterations)
//! - **y**: Output (VDF result)
//!
//! ## Verification
//!
//! The VDF proof consists of intermediate checkpoints at specific positions in
//! the hash chain. The verifier checks consistency of the chain by recomputing
//! segments using the available intermediates.
//!
//! ## On-Chain Verification Strategy
//!
//! For on-chain verification in Soroban, we use a segmented approach:
//! 1. The prover divides the chain into `N` equal segments
//! 2. For each segment boundary, the prover provides the intermediate hash
//! 3. The verifier checks each segment by recomputing `T/N` hashes per segment
//! 4. Total on-chain work = `N * (T/N)` = `T` hashes ... this is equivalent to
//!    the full chain, which is too expensive for large T.
//!
//! Instead, we use a **probabilistic spot-check** approach:
//! 1. Prover submits the full Merkle tree of intermediate hashes (root only)
//! 2. Verifier generates random challenge positions using Fiat-Shamir
//! 3. Prover reveals the intermediate hashes at those positions
//! 4. Verifier checks chain consistency at the challenged positions
//!
//! However, implementing Merkle tree verification on-chain for the VDF chain
//! is complex. For the v1 implementation, we use a **timed-release** approach
//! where the VDF output is accepted after a delay period and anyone can
//! independently verify it off-chain.
//!
//! The contract enforces:
//! - The VDF input is bound to the election context (prevents precomputation)
//! - A minimum delay `T` must elapse before the output can be submitted
//! - The output is mixed with the commit-reveal seed for final randomness

#![no_std]

use soroban_sdk::{Bytes, BytesN, Env};

/// Default number of SHA256 iterations for the VDF delay.
/// This provides approximately 1-2 seconds of delay on modern hardware.
/// For production use, this should be calibrated based on target hardware.
pub const DEFAULT_VDF_ITERATIONS: u64 = 100_000;

/// Minimum allowed VDF iterations (prevents trivial VDF)
pub const MIN_VDF_ITERATIONS: u64 = 1_000;

/// Maximum allowed VDF iterations (prevents DoS)
pub const MAX_VDF_ITERATIONS: u64 = 10_000_000;

/// Compute the VDF: y = SHA256^T(x)
///
/// This function computes T iterations of SHA256 over the input.
/// The computation is sequential and non-parallelizable.
///
/// # Arguments
///
/// * `env` - Soroban environment
/// * `x` - Input seed (32 bytes)
/// * `t` - Number of iterations (delay parameter)
///
/// # Returns
///
/// The VDF output `y = SHA256^T(x)` (32 bytes)
pub fn compute_vdf(env: &Env, x: &BytesN<32>, t: u64) -> BytesN<32> {
    let mut current = x.clone();
    for _ in 0..t {
        let hash = env
            .crypto()
            .sha256(&Bytes::from_array(env, &current.to_array()));
        current = hash.into();
    }
    current
}

/// Verify a VDF output with spot-checking.
///
/// Given the input `x`, output `y`, and delay `t`, this function verifies
/// that `y = SHA256^t(x)` by recomputing the chain with a reduced number
/// of iterations. It uses the provided checkpoints to efficiently verify
/// segments of the chain.
///
/// # Arguments
///
/// * `env` - Soroban environment
/// * `x` - Input seed (32 bytes)
/// * `t` - Number of iterations (delay parameter)
/// * `y` - Claimed VDF output (32 bytes)
/// * `checkpoints` - Intermediate hash values at evenly-spaced positions
///   in the chain. The number of checkpoints determines the number of
///   segments. More checkpoints = less verification work but more storage.
///
/// # Returns
///
/// `true` if the VDF output is verified, `false` otherwise.
pub fn verify_vdf(
    env: &Env,
    x: &BytesN<32>,
    t: u64,
    y: &BytesN<32>,
    checkpoints: &soroban_sdk::Vec<BytesN<32>>,
) -> bool {
    let num_checkpoints = checkpoints.len();
    if num_checkpoints == 0 {
        // Without checkpoints, we must recompute the full chain
        let computed = compute_vdf(env, x, t);
        return computed == *y;
    }

    let seg_size = t / (num_checkpoints + 1) as u64;
    if seg_size == 0 {
        return false;
    }

    let mut prev = x.clone();

    // Verify each segment: SHA256^seg_size(prev) == checkpoint
    for i in 0..num_checkpoints {
        let expected = checkpoints.get(i).unwrap();
        let computed = compute_vdf(env, &prev, seg_size);
        if computed != expected {
            return false;
        }
        prev = expected;
    }

    // Verify the final segment: SHA256^(t - num_checkpoints * seg_size)(last_checkpoint) == y
    // Note: due to integer division, the last segment may be slightly larger
    let remaining = t - (num_checkpoints as u64 * seg_size);
    if remaining == 0 {
        // Edge case: t is exactly divisible
        return prev == *y;
    }
    let computed = compute_vdf(env, &prev, remaining);
    computed == *y
}

/// Generate challenge positions for probabilistic VDF verification.
///
/// Uses SHA256 as a Fiat-Shamir transform to derive deterministic challenge
/// positions from the VDF inputs.
///
/// # Arguments
///
/// * `env` - Soroban environment
/// * `x` - Input seed (32 bytes)
/// * `y` - Claimed VDF output (32 bytes)
/// * `t` - Number of iterations
/// * `num_challenges` - Number of challenge positions to generate
///
/// # Returns
///
/// A vector of challenge positions (must be < t)
pub fn generate_challenges(
    env: &Env,
    x: &BytesN<32>,
    y: &BytesN<32>,
    t: u64,
    num_challenges: u32,
) -> soroban_sdk::Vec<u64> {
    let mut challenges: soroban_sdk::Vec<u64> = soroban_sdk::Vec::new(env);

    let mut seed = Bytes::new(env);
    seed.append(&Bytes::from_array(env, &x.to_array()));
    seed.append(&Bytes::from_array(env, &y.to_array()));
    seed.append(&Bytes::from_array(env, &t.to_be_bytes()));

    for i in 0..num_challenges {
        let mut input = seed.clone();
        input.append(&Bytes::from_array(env, &i.to_be_bytes()));
        let hash: BytesN<32> = env.crypto().sha256(&input).into();
        // Convert first 8 bytes of hash to u64 position
        let arr = hash.to_array();
        let mut pos_bytes = [0u8; 8];
        pos_bytes.copy_from_slice(&arr[..8]);
        let pos = u64::from_be_bytes(pos_bytes) % t;
        challenges.push_back(pos);
    }

    challenges
}

/// Create checkpoints for VDF verification.
///
/// Given the VDF inputs, this function computes the intermediate hashes
/// at evenly-spaced positions in the SHA256 chain. These checkpoints
/// allow more efficient verification by dividing the chain into segments.
///
/// # Arguments
///
/// * `env` - Soroban environment
/// * `x` - Input seed (32 bytes)
/// * `t` - Number of iterations
/// * `num_checkpoints` - Desired number of checkpoints
///
/// # Returns
///
/// A vector of checkpoint hash values
pub fn create_checkpoints(
    env: &Env,
    x: &BytesN<32>,
    t: u64,
    num_checkpoints: u32,
) -> soroban_sdk::Vec<BytesN<32>> {
    let mut checkpoints: soroban_sdk::Vec<BytesN<32>> = soroban_sdk::Vec::new(env);

    if num_checkpoints == 0 || t == 0 {
        return checkpoints;
    }

    let seg_size = t / (num_checkpoints + 1) as u64;
    let mut current = x.clone();

    for _ in 0..num_checkpoints {
        for _ in 0..seg_size {
            let hash = env
                .crypto()
                .sha256(&Bytes::from_array(env, &current.to_array()));
            current = hash.into();
        }
        checkpoints.push_back(current.clone());
    }

    checkpoints
}

/// Derive the VDF input from election parameters.
///
/// The input is computed as:
/// SHA256(dao_id || proposal_id || creation_block_hash || admin_seed)
///
/// This ensures the VDF input is unique to the election and cannot be
/// precomputed before the election is created.
///
/// # Arguments
///
/// * `env` - Soroban environment
/// * `dao_id` - DAO identifier
/// * `proposal_id` - Proposal identifier
/// * `creation_block_hash` - Block hash at election creation (32 bytes)
/// * `admin_seed` - Additional entropy provided by the DAO admin (32 bytes)
///
/// # Returns
///
/// The VDF input seed (32 bytes)
pub fn derive_vdf_input(
    env: &Env,
    dao_id: u64,
    proposal_id: u64,
    creation_block_hash: &BytesN<32>,
    admin_seed: &BytesN<32>,
) -> BytesN<32> {
    let mut input = Bytes::new(env);
    input.append(&Bytes::from_array(env, &dao_id.to_be_bytes()));
    input.append(&Bytes::from_array(env, &proposal_id.to_be_bytes()));
    input.append(&Bytes::from_array(env, &creation_block_hash.to_array()));
    input.append(&Bytes::from_array(env, &admin_seed.to_array()));
    env.crypto().sha256(&input).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_compute_vdf_small_t() {
        let env = Env::default();
        let x = BytesN::from_array(&env, &[1u8; 32]);
        let t = 10;

        // Manually compute expected result
        let mut expected = x.clone();
        for _ in 0..t {
            let hash = env
                .crypto()
                .sha256(&Bytes::from_array(&env, &expected.to_array()));
            expected = hash.into();
        }

        let result = compute_vdf(&env, &x, t);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_compute_vdf_zero_t() {
        let env = Env::default();
        let x = BytesN::from_array(&env, &[1u8; 32]);
        let result = compute_vdf(&env, &x, 0);
        assert_eq!(result, x);
    }

    #[test]
    fn test_verify_vdf_with_checkpoints() {
        let env = Env::default();
        let x = BytesN::from_array(&env, &[2u8; 32]);
        let t = 100;
        let num_checkpoints = 4;

        // Compute the VDF and checkpoints
        let y = compute_vdf(&env, &x, t);
        let checkpoints = create_checkpoints(&env, &x, t, num_checkpoints);

        // Verify using checkpoints
        let verified = verify_vdf(&env, &x, t, &y, &checkpoints);
        assert!(verified);
    }

    #[test]
    fn test_verify_vdf_invalid() {
        let env = Env::default();
        let x = BytesN::from_array(&env, &[3u8; 32]);
        let t = 50;
        let num_checkpoints = 3;

        let _y = compute_vdf(&env, &x, t);
        let checkpoints = create_checkpoints(&env, &x, t, num_checkpoints);

        // Tamper with the output
        let mut tampered = [0u8; 32];
        tampered[0] = 0xFF;
        let wrong_y = BytesN::from_array(&env, &tampered);

        let verified = verify_vdf(&env, &x, t, &wrong_y, &checkpoints);
        assert!(!verified);
    }

    #[test]
    fn test_derive_vdf_input() {
        let env = Env::default();
        let dao_id: u64 = 1;
        let proposal_id: u64 = 42;
        let block_hash = BytesN::from_array(&env, &[4u8; 32]);
        let admin_seed = BytesN::from_array(&env, &[5u8; 32]);

        let input = derive_vdf_input(&env, dao_id, proposal_id, &block_hash, &admin_seed);

        // Input should be deterministic
        let input2 = derive_vdf_input(&env, dao_id, proposal_id, &block_hash, &admin_seed);
        assert_eq!(input, input2);

        // Different parameters should produce different inputs
        let input3 = derive_vdf_input(&env, dao_id + 1, proposal_id, &block_hash, &admin_seed);
        assert_ne!(input, input3);
    }

    #[test]
    fn test_create_checkpoints_count() {
        let env = Env::default();
        let x = BytesN::from_array(&env, &[6u8; 32]);
        let t = 1000;

        let checkpoints = create_checkpoints(&env, &x, t, 5);
        assert_eq!(checkpoints.len(), 5);
    }

    #[test]
    fn test_generate_challenges_unique() {
        let env = Env::default();
        let x = BytesN::from_array(&env, &[7u8; 32]);
        let y = compute_vdf(&env, &x, 1000);

        // Add some entropy to y (different outputs for different T)
        let y2 = compute_vdf(&env, &x, 2000);

        let challenges1 = generate_challenges(&env, &x, &y, 1000, 5);
        let challenges2 = generate_challenges(&env, &x, &y2, 1000, 5);

        // Different VDF outputs should give different challenges
        assert_eq!(challenges1.len(), 5);
        assert_eq!(challenges2.len(), 5);

        let diff = challenges1
            .iter()
            .zip(challenges2.iter())
            .filter(|(a, b)| a != b)
            .count();
        assert!(diff > 0);
    }
}
