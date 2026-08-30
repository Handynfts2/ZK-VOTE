// ZK Proof generation utilities.
//
// By default proofs are generated with the Rust -> WASM BN254 Groth16 prover
// (this crate), which is byte-for-byte compatible with snarkjs' output and the
// on-chain verifier. snarkjs remains as a transparent fallback if the Rust
// module fails to load or errors.
//
// The witness is computed by the circuit's compiled WASM (via `circom_runtime`,
// the same engine the circuit was built with) and fed to the Rust prover as the
// raw binary `.wtns` buffer; the Rust prover then performs the FFT + MSM that
// dominates proof time. `snarkjs` is used only as a transparent fallback.

// `snarkjs` is imported ONLY as a type here and dynamically inside the fallback
// path (see `proveWithRust`/`proveWithSnarkjs`). On the default production path
// (Rust→WASM) it is never loaded. `CircuitSignals` is used only as a type.
import type { CircuitSignals, Groth16Proof } from "snarkjs";

// Shared BN254 field/nullifier validation helpers (#370)
import { assertValidFieldElement, assertValidNullifier } from "../types/index";

// Default to the Rust prover. Force the legacy `snarkjs` prover by setting
// `VITE_ZK_USE_RUST_PROVER=false` (Vite) or `ZK_USE_RUST_PROVER=false`
// (Node/tests). The value is read once at module load.
function rustProverEnabled(): boolean {
  try {
    if (
      (import.meta as { env?: Record<string, string> }).env
        ?.VITE_ZK_USE_RUST_PROVER === "false"
    )
      return false;
  } catch {
    /* import.meta.env unavailable */
  }
  try {
    if (
      (globalThis as { process?: { env?: Record<string, string> } }).process
        ?.env?.ZK_USE_RUST_PROVER === "false"
    )
      return false;
  } catch {
    /* process unavailable */
  }
  return true;
}
const USE_RUST_PROVER = rustProverEnabled();

type RustProver = {
  prove_wtns: (
    zkey: Uint8Array,
    wtns: Uint8Array,
  ) => Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
};

let rustProverPromise: Promise<RustProver> | null = null;

function loadRustProver(): Promise<RustProver> {
  if (!rustProverPromise) {
    rustProverPromise = (async () => {
      const mod = await import("./zkvote_prover/zkvote_prover.js");
      await (mod as unknown as { default: () => Promise<void> }).default();
      return mod as unknown as RustProver;
    })().catch((e) => {
      console.warn("Rust prover failed to load; falling back to snarkjs.", e);
      rustProverPromise = null;
      throw e;
    });
  }
  return rustProverPromise;
}

async function proveWithRust(
  input: Record<string, unknown>,
  wasmPath: string | Uint8Array,
  zkeyPath: string | Uint8Array,
): Promise<GeneratedProof> {
  // Compute the witness with the circom WASM (snarkjs' engine).
  const { WitnessCalculatorBuilder } = await import("circom_runtime");
  const wasmBytes =
    wasmPath instanceof Uint8Array
      ? wasmPath
      : new Uint8Array(await (await fetch(wasmPath)).arrayBuffer());
  const wc = await WitnessCalculatorBuilder(wasmBytes, {});

  // circom_runtime expects field elements as BigInt (snarkjs does the same
  // via unstringifyBigInts before calling the witness calculator).
  const toBig = (v: unknown): unknown => {
    if (typeof v === "string") return BigInt(v);
    if (typeof v === "number") return BigInt(v);
    if (Array.isArray(v)) return v.map(toBig);
    return v;
  };
  const bigInput: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) bigInput[k] = toBig(v);

  // Return the raw binary `.wtns` buffer (position-0 `1` signal included),
  // exactly what the Rust `prove_wtns` entry point expects.
  const witnessBytes = (await wc.calculateWitness(
    bigInput,
    true,
  )) as Uint8Array;

  const zkeyBytes =
    zkeyPath instanceof Uint8Array
      ? zkeyPath
      : new Uint8Array(await (await fetch(zkeyPath)).arrayBuffer());

  const prover = await loadRustProver();
  const res = await prover.prove_wtns(zkeyBytes, witnessBytes);
  return { proof: res.proof, publicSignals: res.publicSignals };
}

export interface VoteProofInput {
  secret: string;
  salt: string;
  blindingFactor: string;
  root: string;
  nullifier: string;
  daoId: string;
  proposalId: string;
  voteChoice: string; // "0" for no, "1" for yes
  commitment: string; // Identity commitment - private input, computed internally in circuit
  pathElements: string[];
  pathIndices: number[];
  circuitVersion?: string; // "v1" or "v2" (defaults to "v1")
  chainId?: string; // Required for v2 circuits
}

export interface CommentProofInput {
  secret: string;
  salt: string;
  blindingFactor: string;
  root: string;
  nullifier: string;
  daoId: string;
  proposalId: string;
  commentNonce: string; // Nonce for multiple comments (0, 1, 2, ...)
  commitment: string; // Identity commitment - used for proof generation (private circuit input)
  pathElements: string[];
  pathIndices: number[];
  circuitVersion?: string; // "v1" or "v2" (defaults to "v1")
  parentCommentId?: string; // Required for v2 circuits
}

// Legacy alias for backwards compatibility
export type ProofInput = VoteProofInput;

export interface ClaimProofInput {
  secret: string;
  salt: string;
  blindingFactor?: string;
  root: string;
  voteNullifier: string;
  claimNullifier: string;
  daoId: string;
  proposalId: string;
  pathElements: string[];
  pathIndices: number[];
}

// Domain tag for claim nullifier: ascii("claim") = 0x636c61696d = 427020085613 (BN254 Fr element)
// Distinct arity (4 vs 3) ensures vote and claim nullifiers never collide.
export const CLAIM_TAG = "427020085613";

export interface GeneratedProof {
  proof: Groth16Proof;
  publicSignals: string[];
}

let activeProofGenerationCount = 0;

/**
 * Check whether a proof generation operation is currently running.
 */
export function isProofGenerationActive(): boolean {
  return activeProofGenerationCount > 0;
}

/**
 * Generate a Groth16 proof for anonymous voting
 * @param input Proof input parameters
 * @param wasmPath Path to compiled circuit WASM, or an already-downloaded buffer
 * @param zkeyPath Path to proving key, or an already-downloaded buffer
 * @returns Generated proof and public signals
 */
export async function generateVoteProof(
  input: VoteProofInput,
  wasmPath: string | Uint8Array,
  zkeyPath: string | Uint8Array,
): Promise<GeneratedProof> {
  if (activeProofGenerationCount > 0) {
    throw new Error(
      "A proof generation process is already in progress. Please wait for it to finish.",
    );
  }
  activeProofGenerationCount++;
  try {
    const circuitVersion = input.circuitVersion || "v1";

    let circuitInput: CircuitSignals;

    if (circuitVersion === "v2") {
      // vote_v2.circom
      circuitInput = {
        root: input.root,
        nullifier: input.nullifier,
        daoId: input.daoId,
        proposalId: input.proposalId,
        voteChoice: input.voteChoice,
        chainId: input.chainId || "0",
        secret: input.secret,
        salt: input.salt,
        blindingFactor: input.blindingFactor,
        pathElements: input.pathElements,
        pathIndices: input.pathIndices,
      };
    } else {
      // vote_v1.circom
      circuitInput = {
        root: input.root,
        nullifier: input.nullifier,
        daoId: input.daoId,
        proposalId: input.proposalId,
        voteChoice: input.voteChoice,
        secret: input.secret,
        salt: input.salt,
        blindingFactor: input.blindingFactor,
        pathElements: input.pathElements,
        pathIndices: input.pathIndices,
      };
    }

    // Generate proof with the Rust WASM prover (snarkjs fallback).
    if (USE_RUST_PROVER) {
      try {
        return await proveWithRust(circuitInput, wasmPath, zkeyPath);
      } catch (e) {
        console.warn("Rust vote prover failed; falling back to snarkjs.", e);
      }
    }

    // Validate public signals before proof generation (#370)
    // Prevents malformed values from causing hard-to-diagnose WASM errors.
    assertValidNullifier(input.nullifier);
    assertValidFieldElement(input.root, "root");

    // Fallback path: load `snarkjs` dynamically so it is NOT part of the
    // default (Rust) production bundle.
    const { groth16 } = await import("snarkjs");
    const { proof, publicSignals } = await groth16.fullProve(
      circuitInput,
      wasmPath,
      zkeyPath,
    );

    return { proof, publicSignals };
  } catch (error) {
    console.error("Failed to generate vote proof:", error);
    throw new Error(
      `Vote proof generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    activeProofGenerationCount = Math.max(0, activeProofGenerationCount - 1);
  }
}

/**
 * Generate a Groth16 proof for v2 circuit (with chainId)
 * Convenience wrapper around generateVoteProof
 */
export async function generateVoteProofV2(
  input: VoteProofInput,
  wasmPath: string | Uint8Array = "/circuits/vote_v2/vote_v2.wasm",
  zkeyPath: string | Uint8Array = "/circuits/vote_v2/vote_v2_final.zkey",
): Promise<GeneratedProof> {
  return generateVoteProof(
    { ...input, circuitVersion: "v2" },
    wasmPath,
    zkeyPath,
  );
}

/**
 * Generate a Groth16 proof for Vote-to-Earn claim
 * Public signals: [root, voteNullifier, claimNullifier, daoId, proposalId]
 */
export async function generateClaimProof(
  input: ClaimProofInput,
  wasmPath: string | Uint8Array = "/circuits/claim.wasm",
  zkeyPath: string | Uint8Array = "/circuits/claim_final.zkey",
): Promise<GeneratedProof> {
  if (activeProofGenerationCount > 0) {
    throw new Error(
      "A proof generation process is already in progress. Please wait for it to finish.",
    );
  }
  activeProofGenerationCount++;
  try {
    const circuitInput: CircuitSignals = {
      root: input.root,
      voteNullifier: input.voteNullifier,
      claimNullifier: input.claimNullifier,
      daoId: input.daoId,
      proposalId: input.proposalId,
      secret: input.secret,
      salt: input.salt,
      pathElements: input.pathElements,
      pathIndices: input.pathIndices,
    };
    // Reuse same prover path as vote (Rust → snarkjs fallback)
    if (USE_RUST_PROVER) {
      try {
        // Directly use proveWithRust with explicit big-int conversion inside
        // For claim we fall back to snarkjs fullProve which handles witness calc
        // to avoid duplicating Rust witness logic for new circuit. This keeps
        // claim compatible with snarkjs-generated zkeys until Rust prover is
        // extended for claim.
        throw new Error("claim Rust prover not yet wired — use snarkjs");
      } catch (e) {
        // fall through to snarkjs
      }
    }
    const { groth16 } = await import("snarkjs");
    const { proof, publicSignals } = await groth16.fullProve(
      circuitInput,
      wasmPath,
      zkeyPath,
    );
    return { proof, publicSignals };
  } catch (error) {
    console.error("Failed to generate claim proof:", error);
    throw new Error(
      `Claim proof generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    activeProofGenerationCount = Math.max(0, activeProofGenerationCount - 1);
  }
}

/**
 * Generate a Groth16 proof for anonymous commenting
 * @param input Proof input parameters (uses commentNonce instead of voteChoice)
 * @param wasmPath Path to compiled comment circuit WASM, or an already-downloaded buffer
 * @param zkeyPath Path to comment proving key, or an already-downloaded buffer
 * @returns Generated proof and public signals
 */
export async function generateCommentProof(
  input: CommentProofInput,
  wasmPath: string | Uint8Array = "/circuits/comment/comment.wasm",
  zkeyPath: string | Uint8Array = "/circuits/comment/comment_final.zkey",
): Promise<GeneratedProof> {
  if (activeProofGenerationCount > 0) {
    throw new Error(
      "A proof generation process is already in progress. Please wait for it to finish.",
    );
  }
  activeProofGenerationCount++;
  try {
    const circuitVersion = input.circuitVersion || "v1";

    let circuitInput: CircuitSignals;

    if (circuitVersion === "v2") {
      // comment_v2.circom - adds parentCommentId as 7th public signal
      circuitInput = {
        root: input.root,
        nullifier: input.nullifier,
        daoId: input.daoId,
        proposalId: input.proposalId,
        commentNonce: input.commentNonce,
        commitment: input.commitment,
        parentCommentId: input.parentCommentId || "0",
        secret: input.secret,
        salt: input.salt,
        blindingFactor: input.blindingFactor,
        pathElements: input.pathElements,
        pathIndices: input.pathIndices,
      };
    } else {
      // comment_v1.circom - original 6 public signals
      circuitInput = {
        root: input.root,
        nullifier: input.nullifier,
        daoId: input.daoId,
        proposalId: input.proposalId,
        commentNonce: input.commentNonce,
        commitment: input.commitment,
        secret: input.secret,
        salt: input.salt,
        blindingFactor: input.blindingFactor,
        pathElements: input.pathElements,
        pathIndices: input.pathIndices,
      };
    }

    // Generate proof with the Rust WASM prover (snarkjs fallback).
    if (USE_RUST_PROVER) {
      try {
        return await proveWithRust(circuitInput, wasmPath, zkeyPath);
      } catch (e) {
        console.warn("Rust comment prover failed; falling back to snarkjs.", e);
      }
    }

    // Fallback path: load `snarkjs` dynamically so it is NOT part of the
    // default (Rust) production bundle.
    const { groth16 } = await import("snarkjs");
    const { proof, publicSignals } = await groth16.fullProve(
      circuitInput,
      wasmPath,
      zkeyPath,
    );

    return { proof, publicSignals };
  } catch (error) {
    console.error("Failed to generate comment proof:", error);
    throw new Error(
      `Comment proof generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    activeProofGenerationCount = Math.max(0, activeProofGenerationCount - 1);
  }
}

/**
 * Generate a Groth16 proof for v2 comment circuit (with parentCommentId)
 */
export async function generateCommentProofV2(
  input: CommentProofInput,
  wasmPath: string | Uint8Array = "/circuits/comment_v2/comment_v2.wasm",
  zkeyPath: string | Uint8Array = "/circuits/comment_v2/comment_v2_final.zkey",
): Promise<GeneratedProof> {
  return generateCommentProof(
    { ...input, circuitVersion: "v2" },
    wasmPath,
    zkeyPath,
  );
}

/**
 * Convert snarkjs proof format to Soroban-compatible hex strings
 *
 * After PR #1614, Soroban BN254 host functions use BIG-ENDIAN encoding
 * matching CAP-74 and EVM precompile specifications (EIP-196, EIP-197).
 * snarkjs already outputs big-endian field elements, so NO byte reversal is needed.
 *
 * G2 Fp2 format: Ethereum expects [c1, c0] (imaginary first), while snarkjs
 * outputs [c0, c1] (real first), so we swap each coordinate pair.
 */
export function formatProofForSoroban(proof: Groth16Proof): {
  proof_a: string;
  proof_b: string;
  proof_c: string;
} {
  // Convert field element to BIG-ENDIAN hex (no reversal needed)
  const toHexBE = (value: string): string => {
    const bigInt = BigInt(value);
    return bigInt.toString(16).padStart(64, "0");
  };

  // Format pi_a (G1 point): be_bytes(X) || be_bytes(Y)
  const proof_a = toHexBE(proof.pi_a[0]) + toHexBE(proof.pi_a[1]);

  // Format pi_b (G2 point): [[x.c0, x.c1], [y.c0, y.c1]]
  // Ethereum/Soroban format: be_bytes(X_c1) || be_bytes(X_c0) || be_bytes(Y_c1) || be_bytes(Y_c0)
  // snarkjs outputs: [[c0, c1], [c0, c1]] where c0=real, c1=imaginary
  // We swap within each coordinate pair: [c1, c0, c1, c0]
  const proof_b =
    toHexBE(proof.pi_b[0][1]) + // X.c1 (imaginary)
    toHexBE(proof.pi_b[0][0]) + // X.c0 (real)
    toHexBE(proof.pi_b[1][1]) + // Y.c1 (imaginary)
    toHexBE(proof.pi_b[1][0]); // Y.c0 (real)

  // Format pi_c (G1 point): be_bytes(X) || be_bytes(Y)
  const proof_c = toHexBE(proof.pi_c[0]) + toHexBE(proof.pi_c[1]);

  return { proof_a, proof_b, proof_c };
}

/**
 * Generate a random secret for commitment
 */
export function generateSecret(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  let result = BigInt(0);
  for (let i = 0; i < array.length; i++) {
    result = (result << BigInt(8)) | BigInt(array[i]);
  }
  return result.toString();
}

/**
 * Calculate vote nullifier using Poseidon hash
 * nullifier = Poseidon(secret, daoId, proposalId)
 * For v2: nullifier = Poseidon(secret, daoId, proposalId, chainId)
 */
export async function calculateNullifier(
  secret: string,
  daoId: string,
  proposalId: string,
  circuitVersion: string = "v1",
  chainId?: string,
): Promise<string> {
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();

  let hash;
  if (circuitVersion === "v2" && chainId !== undefined) {
    hash = poseidon.F.toString(
      poseidon([
        BigInt(secret),
        BigInt(daoId),
        BigInt(proposalId),
        BigInt(chainId),
      ]),
    );
  } else {
    hash = poseidon.F.toString(
      poseidon([BigInt(secret), BigInt(daoId), BigInt(proposalId)]),
    );
  }

  return hash;
}

/**
 * Calculate vote nullifier for v2 circuit (includes chainId)
 */
export async function calculateNullifierV2(
  secret: string,
  daoId: string,
  proposalId: string,
  chainId: string,
): Promise<string> {
  return calculateNullifier(secret, daoId, proposalId, "v2", chainId);
}

/**
 * Calculate comment nullifier using Poseidon hash
 * nullifier = Poseidon(secret, daoId, proposalId, commentNonce)
 * The nonce allows multiple comments per proposal from the same user
 */
export async function calculateCommentNullifier(
  secret: string,
  daoId: string,
  proposalId: string,
  commentNonce: string,
): Promise<string> {
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();

  const hash = poseidon.F.toString(
    poseidon([
      BigInt(secret),
      BigInt(daoId),
      BigInt(proposalId),
      BigInt(commentNonce),
    ]),
  );

  return hash;
}

/**
 * Calculate claim nullifier using Poseidon hash with domain tag
 * claimNullifier = Poseidon(secret, daoId, proposalId, CLAIM_TAG)
 * CLAIM_TAG = 427020085613 (ascii "claim") blocks double-claim, distinct from vote nullifier
 */
export async function calculateClaimNullifier(
  secret: string,
  daoId: string,
  proposalId: string,
): Promise<string> {
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  const hash = poseidon.F.toString(
    poseidon([
      BigInt(secret),
      BigInt(daoId),
      BigInt(proposalId),
      BigInt(CLAIM_TAG),
    ]),
  );
  return hash;
}

/** Alias for calculateNullifier — vote nullifier used to gate claims */
export const calculateVoteNullifier = calculateNullifier;

// Domain separation tag for commitment scheme
// SHA-256("ZK-VOTE-COMMITMENT") reduced mod BN254 scalar field
// Must match DOMAIN_TAG in circuits for consistency
const DOMAIN_TAG = BigInt(
  "19666041591797403834655481403982443037438503980743793537655983658411276515161",
);

/**
 * Calculate commitment from secret, salt, and blinding factor using Poseidon hash
 * commitment = Poseidon(DOMAIN_TAG, secret, salt, blindingFactor)
 * Domain-separated commitment prevents cross-protocol attacks.
 */
export async function calculateCommitment(
  secret: string,
  salt: string,
  blindingFactor: string,
): Promise<string> {
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();

  const hash = poseidon.F.toString(
    poseidon([
      DOMAIN_TAG,
      BigInt(secret),
      BigInt(salt),
      BigInt(blindingFactor),
    ]),
  );

  return hash;
}

/**
 * Verify a proof locally before submitting
 * @param proof Generated proof
 * @param publicSignals Public signals
 * @param vkeyPath Path to verification key JSON
 */
export async function verifyProofLocally(
  proof: Groth16Proof,
  publicSignals: string[],
  vkeyPath: string,
): Promise<boolean> {
  try {
    const vkey = await fetch(vkeyPath).then((r) => r.json());
    const { groth16 } = await import("snarkjs");
    const result = await groth16.verify(vkey, publicSignals, proof);
    return result;
  } catch (error) {
    console.error("Local verification failed:", error);
    return false;
  }
}

/**
 * Calculate sha256 hash of a proof payload bound to nullifier, timestamp, and optional nonce
 */
export async function calculateProofHash(
  proof: Groth16Proof,
  nullifier: string,
  timestamp: number,
  nonce?: string,
): Promise<string> {
  const normalizedNullifier = nullifier.startsWith("0x")
    ? nullifier.slice(2)
    : nullifier;
  const data =
    JSON.stringify(proof) +
    ":" +
    normalizedNullifier +
    ":" +
    timestamp +
    ":" +
    (nonce || "");
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encrypt proof payload for the relayer using symmetric AES-GCM (simulated/standard payload format)
 */
export async function encryptProofForRelayer(
  payload: Record<string, unknown>,
  _relayerPubKey?: string,
): Promise<{ encryptedPayload: string }> {
  // Serialize payload
  const jsonString = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);

  // Generate AES-256 key
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );

  const exportedKey = await crypto.subtle.exportKey("raw", key);
  const keyHex = Array.from(new Uint8Array(exportedKey))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const ivHex = Array.from(iv)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const ciphertextHex = Array.from(new Uint8Array(encrypted))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    encryptedPayload: JSON.stringify({
      ciphertext: ciphertextHex,
      iv: ivHex,
      key: keyHex,
    }),
  };
}
