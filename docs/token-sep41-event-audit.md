# SEP-41 Event Schema Audit (Issue #111)

Audit of `contracts/token/src/lib.rs`'s events (there is no separate
`events.rs` in this repo — events are defined inline via
`#[soroban_sdk::contractevent]`) against the SEP-41 standard schema.

| Event | SEP-41 shape | Current shape | Verdict |
|---|---|---|---|
| Transfer | topics=`["transfer", from, to]`, data=`amount` | `#[topic] from`, `#[topic] to`, data=`amount` | Compliant |
| Approve | topics=`["approve", from, spender]`, data=`[amount, expiration_ledger]` | `#[topic] from`, `#[topic] spender`, data=`amount, expiration_ledger` | Compliant |
| Mint | topics=`["mint", admin, to]`, data=`amount` | Was `#[topic] to` only — **`admin` was missing from the event entirely**, not just missing from the topics. Indexers had no way to attribute a mint to the admin who authorized it. | **Fixed in this PR** — added `admin` as a second topic. |
| Burn | topics=`["burn", from]`, data=`amount` | `#[topic] from`, data=`amount, new_supply` | Partially compliant — the extra `new_supply` field in `data` means a strict SEP-41 parser expecting a bare `i128` for `data` would need to instead read a struct/tuple. `new_supply` is genuinely useful (avoids a follow-up `total_supply()` call) but is a real deviation from the letter of the standard. |

## What this PR changes

Added `admin: Address` as a `#[topic]` field on `MintEvent`, and threaded the
already-in-scope `admin` variable through at the `mint()` call site
(`contracts/token/src/lib.rs`). This was a safe, additive change: nothing in
`backend/src/services/indexer.ts` currently parses `MintEvent`'s topics
(confirmed by grep — the only `Mint` reference there is an unrelated
`SbtMintEvent` mapping), so there is no existing consumer to break.

## What this PR does not change

`BurnEvent`'s extra `new_supply` field is a judgment call, not a bug: fixing
it strictly (dropping `new_supply` from event `data`) is a breaking change for
any current or future consumer relying on it, and per the audit above nothing
in this codebase currently parses Burn events either — so there's no
regression risk either way. Given that, changing it isn't a "fast fix" so much
as a design decision (strict-compliance vs. richer event vs. a computed
`new_supply` field for indexers to derive out-of-band), and is left for a
follow-up that also updates `backend/src/services/indexer.ts` to actually
consume these events — which #111's own acceptance criteria calls for and
this PR does not attempt, since there's no existing Transfer/Approve/Mint/Burn
parsing in `indexer.ts` to extend.
