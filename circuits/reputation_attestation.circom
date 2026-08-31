pragma circom 2.1.8;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

// Cross-DAO anonymous reputation portability prototype.
//
// The holder proves knowledge of an attester-issued reputation commitment and
// selectively discloses only that score >= minScore. The subject secret stays
// private and is never the same value used as a vote nullifier.
template ReputationAttestation() {
    signal input sourceDaoId;
    signal input targetDaoId;
    signal input attesterKeyHash;
    signal input minScore;
    signal input attestationCommitment;
    signal input reputationNullifier;

    signal input subjectSecret;
    signal input score;
    signal input attestationSalt;
    signal input revocationNonce;

    component commitmentHasher = Poseidon(5);
    commitmentHasher.inputs[0] <== sourceDaoId;
    commitmentHasher.inputs[1] <== attesterKeyHash;
    commitmentHasher.inputs[2] <== subjectSecret;
    commitmentHasher.inputs[3] <== score;
    commitmentHasher.inputs[4] <== attestationSalt;
    attestationCommitment === commitmentHasher.out;

    component nullifierHasher = Poseidon(4);
    nullifierHasher.inputs[0] <== targetDaoId;
    nullifierHasher.inputs[1] <== attestationCommitment;
    nullifierHasher.inputs[2] <== subjectSecret;
    nullifierHasher.inputs[3] <== revocationNonce;
    reputationNullifier === nullifierHasher.out;

    component threshold = LessThan(64);
    threshold.in[0] <== minScore;
    threshold.in[1] <== score + 1;
    threshold.out === 1;
}

component main {public [sourceDaoId, targetDaoId, attesterKeyHash, minScore, attestationCommitment, reputationNullifier]} = ReputationAttestation();
