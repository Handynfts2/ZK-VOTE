// Expands a vote-circuit input JSON into a full witness using the circom WASM,
// writing the canonical witness values (decimal strings) to an output JSON file.
// Usage: node gen_witness.js <input.json> <output.wtns-or-json>
//
// If the output path ends with .json it writes an array of decimal strings;
// otherwise it writes a snarkjs-compatible .wtns binary.

const fs = require("fs");
const path = require("path");

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error("usage: node gen_witness.js <input.json> <output.json>");
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));

  // circom WASM expects a flat object with array inputs expanded.
  const circuitInput = {
    root: BigInt(input.root),
    nullifier: BigInt(input.nullifier),
    daoId: BigInt(input.daoId),
    proposalId: BigInt(input.proposalId),
    voteChoice: BigInt(input.voteChoice),
    secret: BigInt(input.secret),
    salt: BigInt(input.salt),
    pathElements: input.pathElements.map((x) => BigInt(x)),
    pathIndices: input.pathIndices.map((x) => BigInt(x)),
  };

  const wasmPath = path.join(
    __dirname,
    "..",
    "circuits",
    "build",
    "vote_js",
    "vote.wasm",
  );
  const builder = require(
    path.join(__dirname, "..", "circuits", "build", "vote_js", "witness_calculator.js"),
  );
  const buffer = fs.readFileSync(wasmPath);
  const wc = await builder(buffer, true);
  const w = await wc.calculateWitness(circuitInput);

  if (outputPath.endsWith(".json")) {
    const arr = Array.from(w).map((x) => x.toString());
    fs.writeFileSync(outputPath, JSON.stringify(arr));
    console.log("wrote", arr.length, "witness values to", outputPath);
  } else {
    // snarkjs-compatible wtns binary
    const n8 = 32;
    const nWitness = w.length;
    const q = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    const header = Buffer.alloc(12);
    header.write("wtns", 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(2, 8);
    // section 1: header (n8, q, nWitness)
    const s1 = Buffer.alloc(4 + n8 + 4);
    s1.writeUInt32LE(n8, 0);
    let tmp = q;
    for (let i = 0; i < n8; i++) {
      s1[4 + i] = Number(tmp & 255n);
      tmp >>= 8n;
    }
    s1.writeUInt32LE(nWitness, 4 + n8);
    // section 2: witness data
    const s2 = Buffer.alloc(nWitness * n8);
    for (let i = 0; i < nWitness; i++) {
      let v = w[i] < 0n ? w[i] + q : w[i];
      for (let j = 0; j < n8; j++) {
        s2[i * n8 + j] = Number(v & 255n);
        v >>= 8n;
      }
    }
    const out = Buffer.concat([header, s1, s2]);
    fs.writeFileSync(outputPath, out);
    console.log("wrote wtns binary", out.length, "bytes to", outputPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
