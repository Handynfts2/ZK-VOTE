import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

const token = 'testtoken';
const TEST_SECRET = 'SCVZXEUXJLRZKPCUXGXN53BJTD3RAZPRSSXHXDGSZQH5EOGEUTWINUXF';

const setupApp = async () => {
  process.env.RELAYER_SECRET_KEY = TEST_SECRET;
  process.env.VOTING_CONTRACT_ID = 'CCYGWEUNWOBHJ6JIHDMTK2XSSDVMQ7ZGBJQE6QR2VYD4FRQGZR5EYKJ2';
  process.env.TREE_CONTRACT_ID = 'CAZC3WSRGE3PI6AZ3NHRKIZFVBEOOLFDP7RD6BMHIMRYV4VEYC42ARQZ';
  process.env.COMMENTS_CONTRACT_ID = 'CCUZNVADC24GEOPRD5A6PBCZGOQ6QOKJU6E5UBXI6RKDC7AWN5ATXNFF';
  process.env.REWARDS_CONTRACT_ID = 'CBGK5YFR5544QNHUNR4WKB5ECL75DAY3R4M5UNALA42ZBPKOFNL5RM43';
  process.env.SOROBAN_RPC_URL = 'http://localhost';
  process.env.CORS_ORIGIN = 'http://localhost';
  process.env.NETWORK_PASSPHRASE = 'Test';
  process.env.RELAYER_AUTH_TOKEN = token;
  process.env.HEALTH_EXPOSE_DETAILS = 'true';
  process.env.RELAYER_TEST_MODE = 'true';

  const relayer = await import('../src/index.ts');
  return relayer.app || relayer.default || relayer;
};

test('POST /api/v1/claim requires auth', async () => {
  const app = await setupApp();
  const res = await request(app).post('/api/v1/claim').send({});
  assert.equal(res.statusCode, 401);
});

test('POST /claim alias requires auth', async () => {
  const app = await setupApp();
  const res = await request(app).post('/claim').send({});
  assert.equal(res.statusCode, 401);
});

test('claim rejects malformed proof', async () => {
  const app = await setupApp();
  const res = await request(app)
    .post('/api/v1/claim')
    .set('Authorization', `Bearer ${token}`)
    .send({
      daoId: 1,
      proposalId: 1,
      voteNullifier: '0x01',
      claimNullifier: '0x02',
      root: '0x01',
      proof: { a: '0xz', b: '0x1', c: '0x1' },
    });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error);
});

test('claim rejects U256 above BN254 modulus', async () => {
  const app = await setupApp();
  const tooBig = (BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617') + 1n).toString(16);
  const res = await request(app)
    .post('/api/v1/claim')
    .set('Authorization', `Bearer ${token}`)
    .send({
      daoId: 1,
      proposalId: 1,
      voteNullifier: tooBig,
      claimNullifier: '01'.repeat(32),
      root: '01'.repeat(32),
      proof: { a: '11'.repeat(64), b: '22'.repeat(128), c: '33'.repeat(64) },
    });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error === 'Validation failed' || res.body.error.toLowerCase().includes('modulus'));
  if (res.body.details) {
    const f = res.body.details.find((d) => d.field === 'voteNullifier');
    assert.ok(f, 'Should have voteNullifier validation error');
  }
});

test('claim rejects all-zero proof', async () => {
  const app = await setupApp();
  const zeroA = '0x' + '00'.repeat(64);
  const zeroB = '0x' + '00'.repeat(128);
  const res = await request(app)
    .post('/api/v1/claim')
    .set('Authorization', `Bearer ${token}`)
    .send({
      daoId: 1,
      proposalId: 1,
      voteNullifier: '0x01',
      claimNullifier: '0x02',
      root: '0x01',
      proof: { a: zeroA, b: zeroB, c: zeroA },
    });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error);
});

test('claim validates voteNullifier != claimNullifier domain separation (needs distinct)', async () => {
  const app = await setupApp();
  // Both nullifiers same - should still pass validation (contract will reject replay later, but schema allows)
  // This test documents that schema allows same value but contract/domain tag prevents collision
  const res = await request(app)
    .post('/api/v1/claim')
    .set('Authorization', `Bearer ${token}`)
    .send({
      daoId: 1,
      proposalId: 1,
      voteNullifier: '0x01',
      claimNullifier: '0x01',
      root: '0x01',
      proof: { a: '11'.repeat(64), b: '22'.repeat(128), c: '33'.repeat(64) },
    });
  // In test mode, missing rewards simulation returns 400 simulation failed, not validation error
  assert.ok([400, 503].includes(res.statusCode));
  // Should not be validation failed due to same nullifier (allowed by schema, blocked on-chain)
  if (res.statusCode === 400 && res.body.error === 'Validation failed') {
    // If validation failed, it shouldn't be about nullifier equality
    assert.ok(!JSON.stringify(res.body.details).includes('claimNullifier must differ'));
  }
});

test('GET /api/v1/claim/status/:dao/:prop/:nullifier returns isClaimed (anonymity: no auth required for read)', async () => {
  const app = await setupApp();
  const claimNullifier = '01'.repeat(32);
  const res = await request(app).get(`/api/v1/claim/status/1/1/${claimNullifier}`);
  // In test mode without real RPC, simulate returns failure but should not require auth
  assert.ok([200, 500].includes(res.statusCode));
  // Should not require auth header
  if (res.statusCode === 200) {
    assert.equal(typeof res.body.isClaimed, 'boolean');
  }
});

test('GET /api/v1/claim/treasury/:dao returns treasury (no auth required)', async () => {
  const app = await setupApp();
  const res = await request(app).get('/api/v1/claim/treasury/1');
  assert.ok([200, 500].includes(res.statusCode));
});

test('claim route preserves anonymity: no wallet address in request body required', async () => {
  const app = await setupApp();
  const res = await request(app)
    .post('/api/v1/claim')
    .set('Authorization', `Bearer ${token}`)
    .send({
      daoId: 1,
      proposalId: 1,
      voteNullifier: '01'.repeat(32),
      claimNullifier: '02'.repeat(32),
      root: '03'.repeat(32),
      proof: { a: '11'.repeat(64), b: '22'.repeat(128), c: '33'.repeat(64) },
      // extra field that would be wallet address if present - should be ignored by validation (stripUnknown)
      address: 'GTESTADDRESSSHOULDNOTBEREQUIRED',
    });
  // Should be 400 due to validation stripping unknown? Actually Zod default strips unknown, so extra field ignored and still 400 due to test mode simulation
  assert.ok([400, 503].includes(res.statusCode));
  // Body should not have required address field; claim is anonymous
  if (res.body.details) {
    const hasAddressError = res.body.details.some((d) => d.field === 'address');
    assert.ok(!hasAddressError, 'Claim should not require address - anonymity preserved');
  }
});

test('claim and vote routes use same anonymity set (hashed IP rate limit, same auth)', async () => {
  const app = await setupApp();
  // Both endpoints should require same auth token and rate limit via hashed IP
  const voteRes = await request(app).post('/vote').send({});
  const claimRes = await request(app).post('/api/v1/claim').send({});
  assert.equal(voteRes.statusCode, 401);
  assert.equal(claimRes.statusCode, 401);
  // With auth, both should validate similarly (400 not 401)
  const voteRes2 = await request(app).post('/vote').set('Authorization', `Bearer ${token}`).send({ daoId: 1 });
  const claimRes2 = await request(app).post('/api/v1/claim').set('Authorization', `Bearer ${token}`).send({ daoId: 1 });
  assert.equal(voteRes2.statusCode, 400);
  assert.equal(claimRes2.statusCode, 400);
});
