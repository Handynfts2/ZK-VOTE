/**
 * Voting Routes
 *
 * Handles anonymous vote submission with ZK proofs and proposal results retrieval.
 */

import { Router, type Request, type Response } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";

import { config } from "../config.js";
import { log } from "../services/logger.js";
import {
  server,
  relayerKeypair,
  callWithTimeout,
  simulateTransactionWithCaching,
  waitForTransaction,
  withSequenceLock,
  u256ToScVal,
  proofToScVal,
  scValToU256Hex,
} from "../services/stellar.js";
import {
  authGuard,
  auditLog,
  voteLimiter,
  queryLimiter,
  validateBody,
  validateParams,
} from "../middleware/index.js";
import { voteSchema, proposalParamsSchema, daoParamsSchema } from "../validation/schemas.js";
import type { AsyncHandler } from "../types/index.js";
import {
  getTransactionLog,
  recordTransactionLog,
  updateTransactionLogStatus,
} from "../services/db.js";
import { votesProcessed } from "../services/metrics.js";
import { sharedSingleFlight } from "../utils/singleflight.js";

const router = Router();

/**
 * POST /vote - Submit anonymous vote with ZK proof
 */
router.post("/vote", authGuard, auditLog("vote_relay"), voteLimiter, validateBody(voteSchema), (async (
  req: Request,
  res: Response,
) => {
  // Validated by voteSchema middleware
  const { daoId, proposalId, choice, nullifier, root, proof } =
    config.stripRequestBodies ? {} : req.body;

  try {
    log("info", "vote_request", { daoId, proposalId });

    // Replay protection: check local transaction log
    if (nullifier) {
      const existingTx = getTransactionLog(nullifier);
      if (existingTx && (existingTx.status === "SUCCESS" || existingTx.status === "PENDING")) {
        log("info", "vote_replay_prevented", { nullifier, txHash: existingTx.tx_hash, status: existingTx.status });
        return res.json({
          success: true,
          txHash: existingTx.tx_hash,
          status: existingTx.status === "SUCCESS" ? "SUCCESS" : "PENDING",
          replayed: true,
        });
      }
    }

    // Convert inputs to Soroban types
    let scNullifier: StellarSdk.xdr.ScVal;
    let scRoot: StellarSdk.xdr.ScVal;
    let scProof: StellarSdk.xdr.ScVal;
    try {
      scNullifier = u256ToScVal(nullifier);
      scRoot = u256ToScVal(root);
      scProof = proofToScVal(proof);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    if (config.testMode) {
      return res.status(400).json({ error: "Simulation failed (test mode)" });
    }

    // Build contract call
    const contract = new StellarSdk.Contract(config.votingContractId!);

    const args = [
      StellarSdk.nativeToScVal(daoId, { type: "u64" }),
      StellarSdk.nativeToScVal(proposalId, { type: "u64" }),
      StellarSdk.nativeToScVal(choice, { type: "bool" }),
      scNullifier,
      scRoot,
      scProof,
    ];

    const operation = contract.call("vote", ...args);

    // Serialize account fetch + build + simulate + sign + submit under sequence lock
    // to prevent nonce race conditions between concurrent requests
    const { sendResult, result } = await withSequenceLock(async () => {
      // Get relayer account
      const account = await (server as StellarSdk.rpc.Server).getAccount(
        relayerKeypair.publicKey(),
      );

      // Build transaction
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      // Simulate
      log("info", "simulate_vote", { daoId, proposalId });
      let simResult;
      try {
        simResult = await simulateTransactionWithCaching(tx);
      } catch (err) {
        log("warn", "simulation_failed_rpc", {
          daoId,
          proposalId,
          error: (err as Error).message,
        });
        throw new Error(`SIMULATION_FAILED:Simulation RPC error: ${(err as Error).message}`);
      }

      if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
        log("warn", "simulation_failed", {
          daoId,
          proposalId,
          error: simResult.error,
        });

        let errorMessage = "Transaction simulation failed";
        if (simResult.error) {
          const errorStr = JSON.stringify(simResult.error);
          if (errorStr.includes("already voted")) {
            errorMessage = "You have already voted on this proposal";
          } else if (errorStr.includes("voting period closed")) {
            errorMessage = "Voting period has ended";
          } else if (errorStr.includes("invalid proof")) {
            errorMessage = "Invalid vote proof";
          } else if (errorStr.includes("root must match")) {
            errorMessage = "You are not eligible to vote on this proposal (root mismatch)";
          } else if (errorStr.includes("proposal not found")) {
            errorMessage = "Proposal not found";
          } else if (errorStr.includes("UnreachableCodeReached")) {
            errorMessage =
              "Invalid proof or contract error (proof verification failed)";
          }
        }

        throw new Error(`SIMULATION_FAILED:${errorMessage}`);
      }

      // Prepare and sign
      const preparedTx = StellarSdk.rpc
        .assembleTransaction(tx, simResult)
        .build();
      preparedTx.sign(relayerKeypair as StellarSdk.Keypair);

      // Submit
      log("info", "submit_vote", { daoId, proposalId });
      const sr = await callWithTimeout(
        () => (server as StellarSdk.rpc.Server).sendTransaction(preparedTx),
        "send_vote",
      );

      if (sr.status === "ERROR") {
        if (nullifier) updateTransactionLogStatus(nullifier, "FAILED");
        log("error", "submit_failed", {
          daoId,
          proposalId,
          error: sr.errorResult,
        });
        throw new Error("SUBMIT_FAILED");
      }

      if (nullifier && sr.hash) {
        recordTransactionLog(nullifier, sr.hash, "PENDING");
      }

      // Wait for confirmation
      log("info", "submitted", { txHash: sr.hash, daoId, proposalId });
      const r = await callWithTimeout(
        () => waitForTransaction(sr.hash),
        "wait_for_vote",
      );

      return { sendResult: sr, result: r };
    });

    if (result.status === "SUCCESS") {
      if (nullifier && sendResult.hash) {
        updateTransactionLogStatus(nullifier, "SUCCESS", sendResult.hash);
      }
      votesProcessed.inc({ status: "success" });
      log("info", "vote_success", {
        txHash: sendResult.hash,
        daoId,
        proposalId,
      });
      res.json({
        success: true,
        txHash: sendResult.hash,
        status: result.status,
      });
    } else {
      if (nullifier && sendResult.hash) {
        updateTransactionLogStatus(nullifier, "FAILED", sendResult.hash);
      }
      votesProcessed.inc({ status: "failed" });
      log("error", "vote_failed", {
        txHash: sendResult.hash,
        status: result.status,
      });
      res.status(500).json({
        error: "Transaction failed",
        txHash: sendResult.hash,
        status: result.status,
      });
    }
  } catch (err) {
    if (nullifier) {
      updateTransactionLogStatus(nullifier, "FAILED");
    }
    votesProcessed.inc({ status: "error" });
    log("error", "vote_exception", {
      message: (err as Error).message,
      stack: (err as Error).stack,
    });

    const errMsg = (err as Error).message || "";
    let statusCode = 500;
    let userMessage = "Internal server error";

    if (errMsg.startsWith("SIMULATION_FAILED:")) {
      statusCode = 400;
      userMessage = errMsg.slice("SIMULATION_FAILED:".length);
    } else if (errMsg === "SUBMIT_FAILED") {
      statusCode = 500;
      userMessage = "Transaction submission failed";
    } else if (errMsg.includes("Timeout:")) {
      statusCode = 504;
      userMessage = "Request timeout - please try again";
    } else if (errMsg.includes("Transaction not found after timeout")) {
      statusCode = 504;
      userMessage =
        "Transaction confirmation timeout - vote may have succeeded, please check proposal results";
    } else if (errMsg.includes("getAccount")) {
      statusCode = 503;
      userMessage = "Blockchain RPC temporarily unavailable - please retry";
    } else if (
      errMsg.includes("ECONNREFUSED") ||
      errMsg.includes("ETIMEDOUT")
    ) {
      statusCode = 503;
      userMessage = "Network error - please retry";
    } else if (errMsg.includes("sequence")) {
      statusCode = 503;
      userMessage = "Transaction sequence error - please retry";
    }

    res
      .status(statusCode)
      .json(
        config.genericErrors
          ? { error: userMessage }
          : { error: userMessage, details: errMsg },
      );
  }
}) as AsyncHandler);

/**
 * GET /proposal/:daoId/:proposalId - Get proposal results
 */
router.get("/proposal/:daoId/:proposalId", queryLimiter, validateParams(proposalParamsSchema), (async (
  req: Request,
  res: Response,
) => {
  const { daoId, proposalId } = (req as any).validatedParams;

  try {
    const result = await sharedSingleFlight.do(`proposal:${daoId}:${proposalId}`, async () => {
      const contract = new StellarSdk.Contract(config.votingContractId!);
      const args = [
        StellarSdk.nativeToScVal(daoId, { type: "u64" }),
        StellarSdk.nativeToScVal(proposalId, { type: "u64" }),
      ];

      const operation = contract.call("get_results", ...args);

      const account = await (server as StellarSdk.rpc.Server).getAccount(
        relayerKeypair.publicKey(),
      );
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simResult = await (
        server as StellarSdk.rpc.Server
      ).simulateTransaction(tx);

      if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
        throw new Error("PROPOSAL_NOT_FOUND");
      }

      // Parse results from simulation
      const resultScVal = simResult.result?.retval;
      if (!resultScVal) {
        throw new Error("NO_RESULT_RETURNED");
      }

      // Parse the tuple (yes_votes, no_votes, closed)
      const resultVec = resultScVal.vec();
      if (!resultVec || resultVec.length < 3) {
        throw new Error("INVALID_RESULT_FORMAT");
      }

      const yesVotes = resultVec[0].u64().toString();
      const noVotes = resultVec[1].u64().toString();
      const closed = resultVec[2].b();

      return {
        daoId,
        proposalId,
        yesVotes,
        noVotes,
        closed,
      };
    });

    res.json(result);
  } catch (err) {
    const errMsg = (err as Error).message;
    if (errMsg === "PROPOSAL_NOT_FOUND") {
      return res.status(404).json({ error: "Proposal not found" });
    } else if (errMsg === "NO_RESULT_RETURNED") {
      return res.status(500).json({ error: "No result returned" });
    } else if (errMsg === "INVALID_RESULT_FORMAT") {
      return res.status(500).json({ error: "Invalid result format" });
    }
    log("error", "proposal_fetch_error", {
      daoId,
      proposalId,
      error: errMsg,
    });
    res.status(500).json({ error: "Failed to fetch proposal results" });
  }
}) as AsyncHandler);

/**
 * GET /root/:daoId - Get current Merkle root for a DAO
 */
router.get("/root/:daoId", queryLimiter, validateParams(daoParamsSchema), (async (
  req: Request,
  res: Response,
) => {
  const { daoId } = (req as any).validatedParams;

  try {
    const result = await sharedSingleFlight.do(`root:${daoId}`, async () => {
      const contract = new StellarSdk.Contract(config.treeContractId!);
      const args = [StellarSdk.nativeToScVal(daoId, { type: "u64" })];

      const operation = contract.call("get_root", ...args);

      const account = await (server as StellarSdk.rpc.Server).getAccount(
        relayerKeypair.publicKey(),
      );
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simResult = await (
        server as StellarSdk.rpc.Server
      ).simulateTransaction(tx);

      if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
        throw new Error("DAO_NOT_FOUND");
      }

      const resultScVal = simResult.result?.retval;
      if (!resultScVal) {
        throw new Error("NO_RESULT_RETURNED");
      }

      const root = scValToU256Hex(resultScVal);

      return {
        daoId,
        root,
      };
    });

    res.json(result);
  } catch (err) {
    const errMsg = (err as Error).message;
    if (errMsg === "DAO_NOT_FOUND") {
      return res
        .status(404)
        .json({ error: "DAO not found or tree not initialized" });
    } else if (errMsg === "NO_RESULT_RETURNED") {
      return res.status(500).json({ error: "No result returned" });
    }
    log("error", "root_fetch_error", { daoId, error: errMsg });
    res.status(500).json({ error: "Failed to fetch Merkle root" });
  }
}) as AsyncHandler);

export default router;
