# Rewards Contract — Vote-to-Earn (Thin Rewards Crate)

**Choice: thin rewards crate vs extending token**

The grant allows either extending `contracts/token` or creating a thin `rewards` crate. We implement `contracts/rewards` for isolation, minimality, and reusability.

- **Why not `contracts/token`**: A Soroban SEP-41 token carries allowances, mint/burn admin paths, and asset-specific logic. Adding claim semantics there couples proof verification to token economics and widens the audit surface. A live token upgrade is riskier than deploying a new rewards contract.
- **Why thin crate**: Rewards stores only `Treasury(dao_id)`, `RewardAmount(dao_id)`, `ClaimNullifier(...)`, and VK versioning. Verification is strictly `claim.circom`'s 5 public signals. It emits `ClaimEvent` for any settlement backend (SEP-41 mint, native XLM transfer, off-chain accounting). To back a specific token, wire `ClaimEvent` → `token.mint(to, amount)` off-chain or copy this module into `contracts/token` verbatim — no behavioral change.

## Protocol

```
secret --Poseidon(secret,salt)--> commitment --MerkleProof--> root (public)
secret --Poseidon(secret,dao,prop)--> voteNullifier (public, must be used in voting contract)
secret --Poseidon(secret,dao,prop, CLAIM_TAG)--> claimNullifier (public, domain-separated)
      CLAIM_TAG = 427020085613 = 0x636c61696d = ascii("claim"), Poseidon arity 4
```

`claim(dao, proposal, voteNullifier, claimNullifier, root, proof)`:

1. Field checks `< r`, non-zero.
2. `claimNullifier` not yet used (`ClaimNullifierUsed` if replay).
3. `voting.is_nullifier_used(voteNullifier) == true` else `NotVoted`.
4. Root validity per `VoteMode` (same as voting).
5. Treasury `>= reward` else `TreasuryInsufficient`.
6. Groth16 verify `e(-A,B)*e(alpha,beta)*e(vk_x,gamma)*e(C,delta)=1`.
7. Mark claimed, debit treasury, `ClaimEvent`.

Double-claim is blocked by storage key `(dao, proposal, claimNullifier)` regardless of proof freshness. Domain separation (`vote` arity 3 vs `claim` arity 4 + tag) prevents cross-protocol nullifier collision.

## Sybil bounds (see THREAT_MODEL.md)

- **SBT-age** (policy): 7-day mint age recommended; future `MintedAt` on-chain gate.
- **Funding caps**: `MAX_FUNDING_CAP = 1e16`, `MAX_REWARD_PER_CLAIM = 1e11`, default `1e9` (100 tokens, 7 decimals).
- **QV**: Flat per-SBT reward is QV with stake=1; pool cap bounds total Sybil profit.
- **Relayer**: `claimLimiter` 10/min/IP, hashed IP, no PII.

## Funding

- `set_reward(dao, amount, admin)` — admin only, amount ∈ (0, MAX_REWARD].
- `fund_treasury(dao, amount, admin)` — admin only, cumulative ≤ MAX_FUNDING_CAP.

## Tests

`cargo test -p rewards` covers success, replay rejection, NotVoted, treasury caps, root mismatch, trailing mode.
