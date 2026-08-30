pragma circom 2.1.8;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

// Spike prototype for DID/eSIM-style signed claims without linking the claim
// to the voting membership commitment.
//
// Public signals:
// - issuerId: field hash of the DID/eSIM issuer.
// - attributeKey: field hash for the disclosed attribute class.
// - minAttributeValue: threshold the holder must satisfy.
// - attributeNullifier: per-issuer/per-attribute uniqueness guard.
//
// Private signals:
// - signedClaimHash: field hash of the issuer-signed DID claim.
// - attributeValue: numeric claim attribute proved against the threshold.
// - claimSalt: holder-side salt used when hashing the claim context.
//
// This circuit deliberately does not take the ZKVote identity commitment,
// daoId, proposalId, or vote nullifier. The output nullifier is scoped only to
// the identity issuer/attribute flow, so it cannot be correlated with votes.
template DidAttributeBinding() {
    signal input issuerId;
    signal input attributeKey;
    signal input minAttributeValue;
    signal input attributeNullifier;

    signal input signedClaimHash;
    signal input attributeValue;
    signal input claimSalt;

    component nullifierHasher = Poseidon(4);
    nullifierHasher.inputs[0] <== issuerId;
    nullifierHasher.inputs[1] <== attributeKey;
    nullifierHasher.inputs[2] <== signedClaimHash;
    nullifierHasher.inputs[3] <== claimSalt;
    attributeNullifier === nullifierHasher.out;

    component threshold = LessThan(64);
    threshold.in[0] <== minAttributeValue;
    threshold.in[1] <== attributeValue + 1;
    threshold.out === 1;
}

component main {public [issuerId, attributeKey, minAttributeValue, attributeNullifier]} = DidAttributeBinding();
