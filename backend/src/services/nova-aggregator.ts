/**
 * Nova IVC Off-Chain Aggregation Service for ZK-VOTE
 *
 * Coordinates collection of vote witnesses, execution of Nova IVC folding,
 * generation of compressed recursive proofs, and relaying to Soroban.
 */

import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface VoteWitnessPayload {
  secret: string;
  salt: string;
  path_elements: string[];
  path_indices: number[];
  vote_choice: number;
  nullifier: string;
  dao_id: number;
  proposal_id: number;
}

export interface IvcState {
  step_count: number;
  root: string;
  yes_votes: number;
  no_votes: number;
  acc_nullifier_hash: string;
}

export interface RecursiveProofPayload {
  initial_state: IvcState;
  final_state: IvcState;
  num_votes: number;
  proof_bytes: string;
  timestamp: number;
}

export class NovaAggregatorService {
  private tempDir: string;

  constructor(tempDir?: string) {
    this.tempDir = tempDir || path.join(process.cwd(), "temp", "nova");
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Aggregates a batch of vote witnesses off-chain into a single Nova recursive proof payload
   */
  async aggregateVotes(
    daoId: number,
    proposalId: number,
    root: string,
    witnesses: VoteWitnessPayload[],
  ): Promise<RecursiveProofPayload> {
    const timestamp = Date.now();
    const batchPath = path.join(
      this.tempDir,
      `batch_${daoId}_${proposalId}_${timestamp}.json`,
    );
    const outputPath = path.join(
      this.tempDir,
      `proof_${daoId}_${proposalId}_${timestamp}.json`,
    );

    try {
      // 1. Write vote witness batch to temp JSON file
      fs.writeFileSync(batchPath, JSON.stringify(witnesses, null, 2), "utf8");

      // 2. Invoke nova-aggregator CLI tool
      const cargoCmd = `cargo run -p nova-aggregator --bin nova-aggregator -- --batch "${batchPath}" --out "${outputPath}" --root "${root}" --benchmark`;

      const { stdout, stderr } = await execAsync(cargoCmd, {
        cwd: path.resolve(__dirname, "../../../"),
      });

      console.info("[NovaService] Aggregation CLI output:", stdout);

      if (!fs.existsSync(outputPath)) {
        throw new Error(
          `Nova aggregator failed to create output proof file: ${stderr}`,
        );
      }

      // 3. Read and parse output recursive proof payload
      const proofRaw = fs.readFileSync(outputPath, "utf8");
      const payload: RecursiveProofPayload = JSON.parse(proofRaw);

      return payload;
    } finally {
      // Cleanup transient files
      if (fs.existsSync(batchPath)) fs.unlinkSync(batchPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
  }
}

export const novaAggregatorService = new NovaAggregatorService();
