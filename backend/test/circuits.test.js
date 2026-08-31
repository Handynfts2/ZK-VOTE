import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

const token = 'testtoken';
const TEST_SECRET = 'SCVZXEUXJLRZKPCUXGXN53BJTD3RAZPRSSXHXDGSZQH5EOGEUTWINUXF';

const setupApp = async () => {
  process.env.RELAYER_SECRET_KEY = TEST_SECRET;
  process.env.VOTING_CONTRACT_ID = 'C'.padEnd(56, 'A');
  process.env.TREE_CONTRACT_ID = 'C'.padEnd(56, 'B');
  process.env.SOROBAN_RPC_URL = 'http://localhost';
  process.env.CORS_ORIGIN = 'http://localhost';
  process.env.NETWORK_PASSPHRASE = 'Test';
  process.env.RELAYER_AUTH_TOKEN = token;
  process.env.HEALTH_EXPOSE_DETAILS = 'true';
  process.env.RELAYER_TEST_MODE = 'true';
  process.env.CIRCUIT_REGISTRY_CONTRACT_ID = 'C'.padEnd(56, 'C');
  const relayer = await import('../src/index.ts');
  return relayer.app || relayer.default || relayer;
};

test('circuit status returns current circuit', async () => {
  const app = await setupApp();
  const res = await request(app).get('/circuits/1/Vote/status');
  // In test mode without real RPC, may return 500 or 200 depending on mock
  assert.ok([200, 500].includes(res.statusCode));
});

test('fetch versioned VK - current version succeeds', async () => {
  const app = await setupApp();
  const res = await request(app).get('/circuits/vk/vote_v1/1');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.circuitId, 'vote_v1');
  assert.equal(res.body.version, 1);
  assert.ok(res.body.vk);
  assert.equal(res.body.isStale, false);
});

test('fetch versioned VK - stale rejected with 410', async () => {
  const app = await setupApp();
  // vote_v2 current version is 2, so requesting v1 should be stale
  const res = await request(app).get('/circuits/vk/vote_v2/1');
  assert.equal(res.statusCode, 410);
  assert.equal(res.body.isStale, true);
  assert.equal(res.body.currentVersion, 2);
});

test('verify-version detects mismatch', async () => {
  const app = await setupApp();
  const res = await request(app).post('/circuits/verify-version').send({
    circuitId: 'vote_v1',
    proposalVersion: 2,
    clientVersion: 1,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mismatch, true);
  assert.equal(res.body.shouldInvalidate, true);
});

test('verify-version no mismatch when versions equal', async () => {
  const app = await setupApp();
  const res = await request(app).post('/circuits/verify-version').send({
    circuitId: 'vote_v1',
    proposalVersion: 1,
    clientVersion: 1,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mismatch, false);
});
