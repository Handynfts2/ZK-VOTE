pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "merkle_tree.circom";

// DaoVote Anonymous Comment Circuit v2
//
// Adds parentCommentId as a public signal for proper threading support.
// Upgraded from v1 which had 6 public signals.
//
// Public signals: [root, nullifier, daoId, proposalId, commentNonce, commitment, parentCommentId]
// Private signals: secret, salt, pathElements, pathIndices
//
// parentCommentId enables reply threading: comments can reference a parent
// comment for nested discussion. 0 = top-level comment.
template CommentV2(levels) {
    // Public inputs
    signal input root;              // Merkle tree root (verified on-chain)
    signal input nullifier;         // Prevents duplicate comments with same nonce
    signal input daoId;             // DAO identifier (for domain separation)
    signal input proposalId;        // Which proposal this comment is for
    signal input commentNonce;      // Nonce for multiple comments (0, 1, 2, ...)
    signal input commitment;        // Identity commitment (allows revocation checks)
    signal input parentCommentId;   // Parent comment for threading (0 = top-level)

    // Private inputs
    signal input secret;            // Commenter's secret (like password)
    signal input salt;              // Random salt for commitment
    signal input pathElements[levels];  // Merkle proof siblings
    signal input pathIndices[levels];   // Merkle proof path (0=left, 1=right)

    // 1. Compute identity commitment: Poseidon(secret, salt)
    // and verify it matches the public commitment input
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== salt;

    commitment === commitmentHasher.out;

    // 2. Verify Merkle tree inclusion
    component merkleProof = MerkleTreeInclusionProof(levels);
    merkleProof.leaf <== commitment;
    for (var i = 0; i < levels; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    root === merkleProof.root;

    // 3. Compute nullifier: Poseidon(secret, daoId, proposalId, commentNonce)
    component nullifierHasher = Poseidon(4);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== daoId;
    nullifierHasher.inputs[2] <== proposalId;
    nullifierHasher.inputs[3] <== commentNonce;

    nullifier === nullifierHasher.out;
}

// Default tree depth of 18 (supports ~262K members)
// Public signals: [root, nullifier, daoId, proposalId, commentNonce, commitment, parentCommentId] - 7 signals
component main {public [root, nullifier, daoId, proposalId, commentNonce, commitment, parentCommentId]} = CommentV2(18);
