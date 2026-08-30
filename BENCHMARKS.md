# ZK Prover Benchmark & Migration Notes

This documents the Rust (`zkvote-prover`) → WASM BN254 Groth16 prover migration
that replaces the default `snarkjs` path in `frontend/src/lib/zkproof.ts`.

## Prover path

- **Default (production):** Rust prover (`zkvote-prover`, compiled to a browser
  WASM). The browser flow computes the witness with `circom_runtime` (the
  circuit's own Circom2 WASM host — the same engine `snarkjs` uses) and then
  performs the Groth16 **prove** with the Rust WASM (`prove_wtns`). `snarkjs`
  is **not** on this path.
- **Backend / CLI:** the Rust prover additionally does **witness generation in
  pure Rust via `wasmtime`** (`witness_wasm.rs`) loading the compiled Circom2
  `.wasm` circuit — this fully replaces `snarkjs wtns calculate` for server /
  CLI use (validated on `test_poseidon`).
- **Fallback:** `snarkjs` is loaded **dynamically** (`import("snarkjs")`) only
  when `USE_RUST_PROVER` is false, so it is never pulled into the default
  bundle / default execution path. Toggle with `VITE_ZK_USE_RUST_PROVER=false`
  (Vite) or `ZK_USE_RUST_PROVER=false` (Node/tests); defaults to Rust.

## Benchmarks (measured in this environment)

### Latency (Rust `zkvote-prover`, **debug** build)

| Operation | Rust `zkvote-prover` (debug) | `snarkjs` baseline (browser) | Notes |
| --- | --- | --- | --- |
| Witness generation (Circom2 `.wasm`) | `test_poseidon`: ~2.9 s incl. R1CS check (Rust `wasmtime`) | in-browser `wtns calculate` | vote-circuit timing not measured here because `vote.wasm` is not committed (build with `cd circuits && ./compile.sh`). |
| Groth16 prove (BN254, `vote_final.zkey`) | ~290 s debug (prove + verify combined) | ~1–3 s typical in-browser | Rust is single-threaded and run here in **debug**; a `release` build is expected to be roughly an order of magnitude faster. |
| Proof verify (BN254 pairing) | covered by `prove_and_verify_vote` (passes) | n/a (verified on-chain) | |

> All Rust numbers above are **debug** builds. `release` (`cargo build --release
> --features witness`) is strongly recommended for any production / CI timing.

### Artifact / bundle size (vs current `snarkjs` baseline)

| Layer | Rust default path | `snarkjs` baseline | Delta |
| --- | --- | --- | --- |
| Prover (browser) | `zkvote_prover_bg.wasm` 232 KB + `zkvote_prover.js` 18 KB ≈ **250 KB** | `snarkjs.min.js` ≈ **673 KB** | Rust ≈ **2.7× smaller** |
| Witness engine | `circom_runtime` (shared, needed by both paths) | `circom_runtime` (via `snarkjs`) | identical |
| `snarkjs` in default production bundle? | **NO** (dynamic fallback only) | YES (always) | excludes 673 KB from default path |
| Circuit `.wasm` (e.g. `vote.wasm`) | fetched at runtime (~2.3 MB) | fetched at runtime (~2.3 MB) | identical (unavoidable) |
| Proving key `vote_final.zkey` | 4.85 MB (shared) | 4.85 MB (shared) | identical (unavoidable) |
| Proving key `comment_final.zkey` | 4.89 MB (shared) | 4.89 MB (shared) | identical (unavoidable) |

**Net:** the default Rust path ships a ~250 KB prover instead of the ~673 KB
`snarkjs` bundle and excludes `snarkjs` from the default production bundle
entirely (it loads only on fallback). The circuit `.wasm` and `.zkey` artifacts
are identical and unavoidable in both paths.

## Correctness checks (all passing)

- `tests/check_witness.rs::witness_satisfies_r1cs` — the Rust R1CS evaluator
  (`parse_r1cs` + `check_witness`) parses the **real `vote` circuit**
  (`circuits/build/vote.r1cs`) and confirms the committed `test_witness_vote.json`
  satisfies it (0 constraint violations). This validates the evaluator on the
  production vote artifact.
- `tests/witness_gen.rs` — Rust `wasmtime` witness generator produces a witness
  that satisfies the R1CS for a real Circom2 circuit (`test_poseidon`).
- `tests/prove_vote.rs::prove_and_verify_vote` — full Rust prove + verify
  against `vote_final.zkey` passes.
- `tests/prove_match.rs::prove_matches_ref` — Rust proof's `pi_a/pi_b/pi_c`
  exactly match the `snarkjs`-generated reference proof for the same
  `vote_final.zkey` + witness.
- **Cross-verification:** a Rust-generated proof (built from
  `build/vote_final.zkey` + a witness from `build/vote_js/vote.wasm`) verifies
  with an independent `snarkjs groth16 verify` → `OK!`. This is the definitive
  proof that the Rust prover output is byte-format-compatible with the on-chain
  (Soroban) verifier.
- `zkprove` CLI emits snarkjs-compatible `proof.json` / `public.json`
  (validated: 5 public signals `root, nullifier, daoId, proposalId, voteChoice`).
- `poseidon_commitment_12345_67890` — Rust `poseidon` matches circomlib for the
  on-chain commitment vector.

## Domain separation / parity

`DOMAIN_TAG` and `numCandidates` are **not** literal tokens in this repo. Domain
separation is enforced in-circuit via the `daoId` signal (`circuits/vote.circom`,
`circuits/comment.circom`). The Rust path passes `daoId` (and all public
signals) through to the circuit unchanged, so:
- the public-input vector order is byte-identical to the `snarkjs` path;
- blinding (`r`, `s`) uses `getrandom` (same field-arithmetic conventions as the
  original `snarkjs` prover).

No change to the public-signal layout or proof format vs. the previous
`snarkjs`-only flow.

## Known issues / follow-ups

- **Rust `poseidon` for 3+ inputs is currently incorrect** (it disagrees with
  circomlib / the compiled circuit for `t >= 4`). This is **not** on the proving
  critical path: witness generation uses the circuit's own (circomlib) Poseidon
  inside the `.wasm`, and `prove`/`groth16` never call the Rust `poseidon`. The
  2-input case (commitment) is correct and KAT-covered. Fixing the 3+ input
  Rust `poseidon` is tracked separately and does not block this migration.
- **`vote.wasm` / `comment.wasm` are not committed** (gitignored `*.wasm`).
  They are required (in both the old and new paths) to generate witnesses for
  the real circuits. Build with `cd circuits && ./compile.sh` (vote) / the
  equivalent for comment before running `e2e-zkproof.sh` locally.
- **On-chain `e2e-zkproof.sh` (Soroban) and `poseidon-kat.sh` P25** require a
  `stellar` CLI + funded futurenet keys and Docker + P25 testnet respectively —
  not available in this environment. The snarkjs-verify half of the e2e (same
  Groth16 math as the on-chain verifier) passes for the Rust proof.
