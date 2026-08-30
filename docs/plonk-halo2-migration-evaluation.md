# Evaluation: Migrating from Groth16 to PLONK/Halo2 (Issue #113)

## Scope of this document

Issue #113 asks for a technical recommendation, not a migration. This document
delivers that: an evaluation of PLONK/Halo2/Nova against ZK-VOTE's actual
Groth16 circuits (`circuits/vote.circom`, `vote_v2.circom`, `merkle_tree.circom`,
`bridge.circom`, `comment.circom`), the on-chain verifier
(`contracts/zkvote-groth16`), and the trusted-setup ceremony already documented
in `docs/trusted-setup-ceremony.md`. A prototype circuit rewrite, browser-WASM
prover benchmarks, and a phased migration plan (the remaining acceptance
criteria) are out of scope for this PR — see "What this doesn't cover" below.

## Why this is being evaluated at all

`docs/trusted-setup-ceremony.md` requires a 20-participant MPC ceremony with a
1-of-N honesty assumption per circuit. Every new circuit (the repo already has
five: vote, vote_v2, merkle_tree, bridge, comment) needs its own Phase 2
ceremony. That's the operational burden #113 is reacting to.

## Comparison, grounded in this repo's constraints

| Property | Groth16 (current) | PLONK | Halo2 (IPA) |
|---|---|---|---|
| Setup | Per-circuit trusted ceremony | Universal + updateable SRS | No trusted setup |
| New circuit cost | Full new MPC ceremony | Reuse existing SRS | Reuse existing params |
| Proof size | ~128 bytes (3 G1 + 1 GT) | ~400–700 bytes | ~1.5–3 KB |
| On-chain verify | 3 pairings | 1 pairing + ~N G1 muls | No pairings (IPA, log-size) |
| Prover cost | Lowest | Medium | Medium–high |
| Recursion | Poor (needs Groth16-specific tricks) | Reasonable | Native strength |
| Tooling maturity for this stack | circom + snarkjs (in use today) | circom-plonk / halo2-circom bridges (less mature) | Native Halo2 (Rust) or Noir — no circom reuse |

Two repo-specific facts change the calculus versus the generic table in the
issue:

1. **`docs/recursive-proof-architecture.md` already exists** — recursion is
   apparently on the roadmap. Groth16 recursion is the weakest of the three
   options here; this is a real point in PLONK/Halo2's favor, not just a
   theoretical one.
2. **Circuits are currently Circom.** Migrating to Halo2 means a full rewrite
   in Rust (or adopting Noir, which is itself an additional new toolchain).
   Migrating to PLONK can often reuse the existing Circom circuits via
   `circom-plonk`/`snarkjs`'s PLONK backend with comparatively small changes —
   a materially cheaper migration path than Halo2 for the same universal-setup
   benefit.

## Recommendation

**Adopt PLONK with a universal SRS, not Halo2, as the near-term target — and
treat this as a new-circuit policy, not a retroactive rewrite.**

Reasoning:

- The dominant cost this issue is trying to eliminate — a fresh 20-party MPC
  ceremony per circuit — is solved equally well by PLONK's universal SRS and
  Halo2's setup-free IPA. PLONK gets that benefit at much lower migration cost
  given the existing Circom investment (`snarkjs` supports a PLONK backend
  against the same circuit source).
- Halo2's real advantage here is recursion, which matters if/when
  `docs/recursive-proof-architecture.md` is implemented. That's worth
  revisiting *if and when* recursion becomes a concrete near-term requirement
  — it is not one today, and adopting Halo2 now means eating a full Circom→Rust
  rewrite for a benefit that isn't yet on the critical path.
- Do **not** migrate the five existing circuits in one shot. Existing verified,
  audited circuits (`vote.circom` has KAT/constraint-analysis docs already —
  see `circuits/POSEIDON_KAT.md`, `CONSTRAINT_ANALYSIS.md`) carry real
  security value in their current, reviewed form. Re-deriving them under a new
  proving system reopens that review surface for no functional gain. New
  circuits going forward should default to PLONK; existing ones migrate only
  when they need to change anyway.

## What this doesn't cover (explicitly deferred, not silently dropped)

The remaining acceptance criteria from #113 require work this PR does not
attempt, because doing it correctly needs dedicated time, not a rushed
addition alongside three unrelated issues:

- Prototyping `vote.circom`'s logic in PLONK and re-benchmarking browser-WASM
  proving time.
- On-chain PLONK verifier cost on Soroban (the 1-pairing-vs-3-pairing gap
  needs to be measured against `contracts/zkvote-groth16`'s actual verified
  gas/resource usage, not assumed from the general-purpose numbers above).
- A phased, dual-verifier migration plan (old Groth16 proofs must keep
  verifying during any transition window).

## Nova

Not recommended for evaluation priority. Nova's main strength is
incrementally-verifiable computation for repeated/folded proofs — this
protocol's ZK use cases (single-vote membership + nullifier proofs) aren't a
natural fit for IVC folding today. Worth revisiting only if a future feature
needs proving a long chain of sequential state transitions (e.g. a
multi-round delegated voting history), which is not current scope.
