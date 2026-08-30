# DID Attribute Binding Spike

This prototype binds an issuer-signed DID/eSIM claim to an anonymous attribute proof without reusing the ZKVote membership commitment.

## Flow

1. The issuer signs an off-chain claim such as `{ subjectDid, simAgeDays, issuer, expiresAt }`.
2. The client hashes the signed claim into `signedClaimHash`.
3. `did_attribute_binding.circom` proves privately that the claim attribute satisfies a public threshold.
4. The public `attributeNullifier` is scoped to `issuerId`, `attributeKey`, `signedClaimHash`, and holder salt.
5. The vote circuit continues to use its existing membership commitment and vote nullifier.

## Privacy Notes

- The circuit does not take `daoId`, `proposalId`, wallet address, membership commitment, or vote nullifier as inputs.
- Attribute nullifiers are not valid vote nullifiers and cannot be joined with voting events.
- Issuer abuse is limited by keeping signed claim material private and by using a per-flow salt.
- Carrier/eSIM verification remains an off-chain trust boundary; production integration should verify the issuer signature before proof generation.

## Prototype Artifacts

- `circuits/did_attribute_binding.circom`
- `backend/src/services/blindSignature.ts` DID claim helpers
- `frontend/src/lib/zk.ts` attribute proof input builder

Closes #313 when paired with the prototype implementation.
