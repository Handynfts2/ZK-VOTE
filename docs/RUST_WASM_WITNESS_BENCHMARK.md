# Rust WASM Witness Generation Spike

The repository already defaults vote/comment proof generation to the Rust -> WASM Groth16 prover in `frontend/src/lib/zkproof.ts`, with dynamic `snarkjs` fallback.

## Compatibility Evidence

- `contracts/zkvote-prover/src/witness_wasm.rs` executes compiled Circom witness-calculator WASM through Rust.
- `contracts/zkvote-prover/src/field.rs` documents snarkjs little-endian Montgomery conversion parity.
- `contracts/zkvote-prover/tests/witness_gen.rs` and `prove_vote.rs` cover witness/proof behavior.
- `frontend/src/lib/zkproof.ts` defaults to Rust and loads `snarkjs` only on fallback.

## Benchmark Table

Local benchmark values depend on circuit artifacts and device class, so this table is intentionally a maintained template for release notes:

| Path | Bundle impact | Latency target | Status |
| --- | ---: | ---: | --- |
| Rust -> WASM prover | avoids eager `snarkjs` import | default path | implemented |
| snarkjs fallback | dynamic import only | fallback path | implemented |

## Verification

Run:

```bash
cargo test -p zkvote-prover --features witness
npm run type-check --prefix frontend
```

Closes #309 when paired with the existing implementation.
