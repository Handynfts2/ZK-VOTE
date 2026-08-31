// Benchmark: weighted_vote vs vote_v2
// Runs simple poseidon ops to compare constraint cost
import { buildPoseidon } from "circomlibjs";

async function bench() {
  const poseidon = await buildPoseidon();
  const iters = 1000;

  const t0 = performance.now();
  for (let i = 0; i < iters; i++) {
    poseidon.F.toString(poseidon([BigInt(123), BigInt(456)]));
  }
  const tPoseidon = performance.now() - t0;

  // Weighted range proof simulation (128-bit decomposition)
  const t1 = performance.now();
  for (let i = 0; i < iters; i++) {
    let acc = BigInt(12345);
    for (let b = 0; b < 128; b++) {
      const bit = (acc >> BigInt(b)) & BigInt(1);
      if (bit !== BigInt(0) && bit !== BigInt(1)) throw new Error("bit");
    }
  }
  const tRange = performance.now() - t1;

  console.log(`Poseidon 2-input x${iters}: ${tPoseidon.toFixed(2)}ms`);
  console.log(`RangeProof 128b x${iters}: ${tRange.toFixed(2)}ms`);
  console.log(`Estimated weighted_vote constraints: ~128 (range) + 2 (poseidon) = 130`);
  console.log(`vote_v2 constraints: ~18*2 (merkle) + 3*poseidon + 1 (binary) ~40`);
  console.log(`Benchmark done`);
}

bench().catch(console.error);
