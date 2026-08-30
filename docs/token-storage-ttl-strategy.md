# Token Contract Storage & TTL Strategy (Issue #112)

## Storage category audit

Soroban has three storage categories with different rent/TTL behavior:
`Instance` (attached to the contract instance, cheap, rarely changes),
`Persistent` (survives archival, incurs ongoing rent, needs periodic TTL
extension), and `Temporary` (auto-expires, cheapest, no extension possible).

Audit of `contracts/token/src/lib.rs`'s `DataKey` variants against this
repo's actual code (not the hypothetical `storage_types.rs` referenced in the
issue — this contract keeps everything in `lib.rs`/`allowance.rs`):

| `DataKey` variant | Category used | Correct? |
|---|---|---|
| Admin / Name / Symbol / Decimals (`instance()` constants, not `DataKey`) | Instance | Yes — already correct, set once in `initialize` |
| `Balance(Address)` | Persistent | Yes — core per-account state, must survive archival |
| Allowance (`allowance.rs`, keyed separately from `DataKey`) | Persistent, TTL bounded by `expiration_ledger` | Yes — already correct, see below |
| `TotalSupply`, `TotalMinted`, `TotalBurned`, `MaxSupply` | Persistent | Yes — global counters, low cardinality, cheap to keep alive |
| `Checkpoints(Address)` | Persistent | Yes — needed for `balance_at()` historical snapshots (issue #106) |
| `Governors`, `RequiredApprovals`, `ClawbackPeriodLimit` | Persistent | Acceptable — low cardinality config, could move to Instance in a future pass but not a cost driver |
| `Delegate(Address)` (new, issue #101) | Persistent | Correct for the same reason as `Balance` — per-account, must survive archival |

**Finding: two of the issue's acceptance criteria were already satisfied
before this PR:**

1. *"Move metadata and admin to Instance storage"* — `initialize()` already
   writes `ADMIN_KEY`/`NAME_KEY`/`SYMBOL_KEY`/`DECIMALS_KEY` via
   `env.storage().instance()`, not persistent storage.
2. *"Set allowance storage TTL to match expiration_ledger"* —
   `allowance.rs::write_allowance` already computes `remaining =
   expiration_ledger - current_seq` and uses it as the TTL threshold/extend
   bounds, so an allowance's storage rent is already scoped to its own
   expiration rather than the default ~535k-ledger window.

## What this PR adds

- **`extend_balance_ttl(id: Address)`** — the one concrete gap: a holder had
  no way to renew their `Balance` entry's TTL without transacting (transfer
  TTL-bumps only the sender/recipient touched by that specific call). This is
  a self-serve, `require_auth`-gated, additive function; it changes no
  existing behavior.

## Explicitly deferred (not done in this PR)

- **Per-account last-activity tracking for "intelligent" TTL renewal** and
  **reducing `backend/src/services/ttl.ts` renewal frequency for inactive
  accounts** — both require deciding a real inactivity threshold and changing
  a backend service that runs against live testnet/mainnet state. That's a
  policy decision (how inactive is "inactive"?) as much as an engineering one,
  and deserves its own review rather than a default picked under time
  pressure in a batch PR. `extend_balance_ttl` above is the building block
  `ttl.ts` would call selectively once that policy is decided.
