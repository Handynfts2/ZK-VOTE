pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "merkle_tree.circom";

// DaoVote Anonymous Vote Circuit v2
//
// Adds chainId as a public signal to prevent cross-chain replay attacks.
// Upgraded from v1 which had 5 public signals.
//
// Public signals: [root, nullifier, daoId, proposalId, voteChoice, chainId]
// Private signals: secret, salt, pathElements, pathIndices
//
// chainId prevents replay attacks: a proof generated for one chain
// (e.g., testnet) cannot be replayed on another chain (e.g., mainnet).
template VoteV2(levels) {
    // Public inputs
    signal input root;              // Merkle tree root (verified on-chain)
    signal input nullifier;         // Prevents double voting (domain-separated)
    signal input daoId;             // DAO identifier (for domain separation)
    signal input proposalId;        // Which proposal this vote is for
    signal input voteChoice;        // 0 = against, 1 = for
    signal input chainId;           // Chain identifier (prevents cross-chain replay)

    // Private inputs
    signal input secret;            // Voter's secret (like password)
    signal input salt;              // Random salt for commitment
    signal input pathElements[levels];  // Merkle proof siblings
    signal input pathIndices[levels];   // Merkle proof path (0=left, 1=right)

    // 1. Compute identity commitment: Poseidon(secret, salt)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== salt;

    signal commitment;
    commitment <== commitmentHasher.out;

    // 2. Verify Merkle tree inclusion
    component merkleProof = MerkleTreeInclusionProof(levels);
    merkleProof.leaf <== commitment;
    for (var i = 0; i < levels; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    root === merkleProof.root;

    // 3. Compute nullifier: Poseidon(secret, daoId, proposalId, chainId)
    // Includes chainId for domain separation across chains
    component nullifierHasher = Poseidon(4);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== daoId;
    nullifierHasher.inputs[2] <== proposalId;
    nullifierHasher.inputs[3] <== chainId;

    nullifier === nullifierHasher.out;

    // 4. Verify vote choice is binary (0 or 1)
    voteChoice * (voteChoice - 1) === 0;
}

// Default tree depth of 18 (supports ~262K members)
// Public signals: [root, nullifier, daoId, proposalId, voteChoice, chainId] - 6 signals
component main {public [root, nullifier, daoId, proposalId, voteChoice, chainId]} = VoteV2(18);
