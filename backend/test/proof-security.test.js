import test from 'node:test';
import assert from 'node:assert/strict';

const token = 'testtoken32characterslongforsecurity12345';
const TEST_SECRET = 'SCVZXEUXJLRZKPCUXGXN53BJTD3RAZPRSSXHXDGSZQH5EOGEUTWINUXF';

process.env.RELAYER_SECRET_KEY = TEST_SECRET;
process.env.VOTING_CONTRACT_ID = 'C'.padEnd(56, 'A');
process.env.TREE_CONTRACT_ID = 'C'.padEnd(56, 'B');
process.env.COMMENTS_CONTRACT_ID = 'C'.padEnd(56, 'C');
process.env.SOROBAN_RPC_URL = 'http://localhost';
process.env.CORS_ORIGIN = 'http://localhost';
process.env.NETWORK_PASSPHRASE = 'Test';
process.env.RELAYER_AUTH_TOKEN = token;
process.env.RELAYER_TEST_MODE = 'true';
process.env.MAX_PROOF_AGE_SECONDS = '300';

const {
  calculateProofHash,
  createSubmissionReceipt,
  verifySubmissionReceipt,
  getRelayerPublicKey,
} = await import('../src/services/proof-encryption.js');

let serverInstance;
let baseUrl = '';

const setupServer = async () => {
  if (baseUrl) return baseUrl;

  const relayer = await import('../src/index.ts');
  const app = relayer.app || relayer.default || relayer;

  await new Promise((resolve) => {
    serverInstance = app.listen(0, () => {
      const port = serverInstance.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve(true);
    });
  });

  return baseUrl;
};

const validProof = {
  a: '11'.repeat(64),
  b: '22'.repeat(128),
  c: '05'.repeat(64),
};
const validNullifier = '0x' + '01'.repeat(32);
const validRoot = '0x' + '01'.repeat(32);

test('getRelayerPublicKey returns public key', () => {
  const pubKey = getRelayerPublicKey();
  assert.ok(pubKey);
  assert.equal(typeof pubKey, 'string');
});

test('receipt generation and verification', () => {
  const receipt = createSubmissionReceipt(
    '0x' + 'aa'.repeat(32),
    validNullifier,
    1,
    1,
    'hash123',
  );
  assert.ok(receipt.receiptId);
  assert.ok(receipt.signature);
  assert.equal(verifySubmissionReceipt(receipt), true);

  // Tamper with receipt
  const tamperedReceipt = { ...receipt, nullifier: '0x' + '02'.repeat(32) };
  assert.equal(verifySubmissionReceipt(tamperedReceipt), false);
});

test('GET /relayer/pubkey returns public key JSON', async () => {
  const base = await setupServer();
  const res = await fetch(`${base}/relayer/pubkey`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.publicKey);
});

test('POST /vote/commit records valid commitment', async () => {
  const base = await setupServer();
  const timestamp = Date.now();
  const commitmentHash = calculateProofHash(validProof, validNullifier, timestamp, 'nonce1');

  const res = await fetch(`${base}/vote/commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      daoId: 1,
      proposalId: 1,
      nullifier: validNullifier,
      commitmentHash,
      timestamp,
      walletAddress: 'GA1234567890',
    }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.status, 'COMMITTED');
  assert.equal(data.commitmentHash, commitmentHash);
});

test('POST /vote/commit rejects stale proof timestamps', async () => {
  const base = await setupServer();
  const oldTimestamp = Date.now() - 400 * 1000; // 400s old (max is 300s)
  const commitmentHash = calculateProofHash(validProof, validNullifier, oldTimestamp, 'nonce1');

  const res = await fetch(`${base}/vote/commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      daoId: 1,
      proposalId: 1,
      nullifier: validNullifier,
      commitmentHash,
      timestamp: oldTimestamp,
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes('expired'));
});

test('POST /vote/commit rejects future timestamps', async () => {
  const base = await setupServer();
  const futureTimestamp = Date.now() + 60 * 1000; // 60s in future
  const commitmentHash = calculateProofHash(validProof, validNullifier, futureTimestamp, 'nonce1');

  const res = await fetch(`${base}/vote/commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      daoId: 1,
      proposalId: 1,
      nullifier: validNullifier,
      commitmentHash,
      timestamp: futureTimestamp,
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes('future'));
});

test('POST /vote verifies commitment and rejects replay of committed proof', async () => {
  const base = await setupServer();
  const timestamp = Date.now();
  const commitmentHash = calculateProofHash(validProof, validNullifier, timestamp, 'nonce2');

  // Step 1: Commit
  const commitRes = await fetch(`${base}/vote/commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      daoId: 1,
      proposalId: 1,
      nullifier: validNullifier,
      commitmentHash,
      timestamp,
    }),
  });
  assert.equal(commitRes.status, 200);

  // Step 2: Reveal
  const revealRes = await fetch(`${base}/vote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      daoId: 1,
      proposalId: 1,
      choice: true,
      nullifier: validNullifier,
      root: validRoot,
      proof: validProof,
      timestamp,
      nonce: 'nonce2',
    }),
  });

  assert.equal(revealRes.status, 400); // simulation failed in test mode

  // Step 3: Re-reveal should be rejected as already revealed
  const reRevealRes = await fetch(`${base}/vote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      daoId: 1,
      proposalId: 1,
      choice: true,
      nullifier: validNullifier,
      root: validRoot,
      proof: validProof,
      timestamp,
      nonce: 'nonce2',
    }),
  });

  assert.equal(reRevealRes.status, 400);
  const reRevealData = await reRevealRes.json();
  assert.ok(reRevealData.error.includes('already revealed'));

  if (serverInstance) {
    serverInstance.close();
  }
});
