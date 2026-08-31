# Anonymous Reputation Portability Spike

This prototype lets a user prove reputation from one DAO to another without disclosing their account or exact score.

## Flow

1. A source DAO attester signs or publishes a reputation commitment.
2. The holder keeps `subjectSecret`, `score`, and `attestationSalt` private.
3. `reputation_attestation.circom` proves the commitment opens correctly and `score >= minScore`.
4. The target DAO receives a scoped `reputationNullifier` for replay protection.
5. Revocation is represented by `revocationNonce`; changing it invalidates previous proofs.

## Selective Disclosure

The public verifier learns only:

- source DAO
- target DAO
- attester key hash
- minimum score threshold
- attestation commitment
- scoped reputation nullifier

It does not learn the exact score, account address, or voting commitment.

## Prototype Artifacts

- `circuits/reputation_attestation.circom`
- `frontend/src/lib/zk.ts` reputation proof input builder

Closes #314 when paired with the prototype implementation.
