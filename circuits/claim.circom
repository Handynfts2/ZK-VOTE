pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "merkle_tree.circom";

// DaoVote Anonymous Claim Circuit (Vote-to-Earn)
//
// Proves:
// 1. Claimer knows secret & salt that hash to a commitment (leaf) in the Merkle tree
// 2. Vote nullifier is correctly derived from secret, daoId, proposalId (proves eligibility: must have voted)
// 3. Claim nullifier is correctly derived with domain tag (prevents double-claim, unlinkable from vote nullifier)
// 4. Commitment membership via Merkle inclusion
//
// Public signals: [root, voteNullifier, claimNullifier, daoId, proposalId]
// Private signals: secret, salt, pathElements, pathIndices
//
// PRIVACY: Commitment is NOT exposed publicly. Claim is unlinkable to vote except via proof (same secret).
// Double-claim protection via claimNullifier domain separation: Poseidon(secret, daoId, proposalId, CLAIM_TAG)
// On-chain checks: voteNullifier must have been used (is_nullifier_used), claimNullifier must be unused.
// Sybil bounds: See THREAT_MODEL.md (SBT-age / QV / funding caps).
template Claim(levels) {
    // Public inputs
    signal input root;              // Merkle tree root (verified on-chain)
    signal input voteNullifier;     // Poseidon(secret, daoId, proposalId) - must be used (proves vote)
    signal input claimNullifier;    // Poseidon(secret, daoId, proposalId, CLAIM_TAG) - prevents double-claim
    signal input daoId;             // DAO identifier (for domain separation)
    signal input proposalId;        // Which proposal this claim is for

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

    // Constrain computed root to match public root
    root === merkleProof.root;

    // 3. Compute vote nullifier: Poseidon(secret, daoId, proposalId)
    // This is the same nullifier as the vote circuit; on-chain gate checks is_nullifier_used
    component voteNullifierHasher = Poseidon(3);
    voteNullifierHasher.inputs[0] <== secret;
    voteNullifierHasher.inputs[1] <== daoId;
    voteNullifierHasher.inputs[2] <== proposalId;

    voteNullifier === voteNullifierHasher.out;

    // 4. Compute claim nullifier: Poseidon(secret, daoId, proposalId, CLAIM_TAG)
    // Domain tag 427020085613 = 0x636c61696d = ascii("claim") prevents collision with vote nullifier
    // Distinct Poseidon arity (4 vs 3) + domain constant ensures double-claim resistance is unlinkable
    component claimNullifierHasher = Poseidon(4);
    claimNullifierHasher.inputs[0] <== secret;
    claimNullifierHasher.inputs[1] <== daoId;
    claimNullifierHasher.inputs[2] <== proposalId;
    claimNullifierHasher.inputs[3] <== 427020085613; // CLAIM_TAG: ascii("claim") = 0x636c61696d

    claimNullifier === claimNullifierHasher.out;
}

// Default tree depth of 18 (supports ~262K members)
// Public signals: [root, voteNullifier, claimNullifier, daoId, proposalId] - 5 signals
component main {public [root, voteNullifier, claimNullifier, daoId, proposalId]} = Claim(18);
