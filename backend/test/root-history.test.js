/**
 * Merkle root history route verification test.
 *
 * Ensures GET /root-history/:daoId/:proposalId is registered in voting.ts and index.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("voting.ts registers Merkle root history route", () => {
  const votingRoutes = fs.readFileSync(
    path.join(__dirname, "../src/routes/voting.ts"),
    "utf8",
  );

  assert.match(
    votingRoutes,
    /\/root-history\/:daoId\/:proposalId/,
    "root history route must be registered with daoId and proposalId",
  );
  assert.match(
    votingRoutes,
    /get_merkle_root_history/,
    "route must call get_merkle_root_history on the voting contract",
  );
});

test("index.ts advertises Merkle root history endpoint", () => {
  const indexSrc = fs.readFileSync(
    path.join(__dirname, "../src/index.ts"),
    "utf8",
  );
  assert.match(indexSrc, /\/root-history\/:daoId\/:proposalId/);
});
