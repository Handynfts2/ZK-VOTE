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
  process.env.COMMENTS_CONTRACT_ID = 'C'.padEnd(56, 'C');
  process.env.BRIDGE_CONTRACT_ID = 'C'.padEnd(56, 'D');
  process.env.DAO_REGISTRY_CONTRACT_ID = 'C'.padEnd(56, 'E');
  const relayer = await import('../src/index.ts');
  return relayer.app || relayer.default || relayer;
};

const clearAll = async () => {
  try {
    const audit = await import('../src/middleware/audit.ts');
    if (audit.clearAuditLog) audit.clearAuditLog();
    if (audit.clearIdempotencyKeys) audit.clearIdempotencyKeys();
    const rem = await import('../src/routes/remediation.ts');
    if (rem.clearRemediationLog) rem.clearRemediationLog();
  } catch {}
};

test('remediation: authz enforced - no token returns 401', async () => {
  const app = await setupApp();
  await clearAll();
  const res = await request(app)
    .post('/remediation/action')
    .send({ action: 'freeze_dao', target: '1', reason: 'test incident', idempotencyKey: 'key-no-auth-12345678' });
  assert.equal(res.statusCode, 401);
});

test('remediation: authz enforced - wrong token returns 401', async () => {
  const app = await setupApp();
  await clearAll();
  const res = await request(app)
    .post('/remediation/action')
    .set('Authorization', 'Bearer wrongtoken')
    .send({ action: 'freeze_dao', target: '1', reason: 'test incident', idempotencyKey: 'key-wrong-12345678' });
  assert.equal(res.statusCode, 401);
});

test('remediation: structured action succeeds and is immutable', async () => {
  const app = await setupApp();
  await clearAll();

  const key = 'immutable-test-' + Date.now();
  const res = await request(app)
    .post('/remediation/action')
    .set('Authorization', `Bearer ${token}`)
    .send({ action: 'freeze_dao', target: '42', reason: 'security incident 123', idempotencyKey: key, metadata: { severity: 'high' } });
  assert.equal(res.statusCode, 201);
  assert.ok(res.body.success);
  assert.ok(res.body.remediationId);
  assert.equal(res.body.record.action, 'freeze_dao');
  assert.equal(res.body.record.target, '42');
  assert.equal(res.body.record.immutable, true);
  // idempotencyKey should be redacted in response
  assert.equal(res.body.record.idempotencyKey, '[REDACTED]');

  const id = res.body.remediationId;

  // Query log - should contain entry
  const logRes = await request(app)
    .get('/remediation/log')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(logRes.statusCode, 200);
  assert.equal(logRes.body.total, 1);
  assert.equal(logRes.body.entries[0].id, id);
  assert.equal(logRes.body.entries[0].immutable, true);
  // No update/delete API should exist - try to POST to update should 404
  const fakeUpdate = await request(app)
    .post(`/remediation/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reason: 'hacked' });
  assert.equal(fakeUpdate.statusCode, 404);

  // GET by id should work
  const single = await request(app)
    .get(`/remediation/${id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(single.statusCode, 200);
  assert.equal(single.body.id, id);
  assert.equal(single.body.immutable, true);

  // Also audited in general audit log
  await new Promise((r) => setTimeout(r, 50));
  const auditRes = await request(app)
    .get('/audit/logs?action=remediation')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(auditRes.statusCode, 200);
  assert.ok(auditRes.body.total >= 1);
  const entry = auditRes.body.entries.find((e) => e.action === 'remediation:freeze_dao');
  assert.ok(entry, 'remediation should be audited');
});

test('remediation: replay-safe - duplicate idempotencyKey returns 409 and does not duplicate', async () => {
  const app = await setupApp();
  await clearAll();

  const key = 'replay-safe-key-' + Date.now();
  const payload = { action: 'pause_voting', target: '99', reason: 'replay test reason', idempotencyKey: key };

  const first = await request(app)
    .post('/remediation/action')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
  assert.equal(first.statusCode, 201);
  const firstId = first.body.remediationId;

  const second = await request(app)
    .post('/remediation/action')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.error.includes('Duplicate'), true);

  // Log should still have only 1 entry
  const logRes = await request(app)
    .get('/remediation/log')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(logRes.body.total, 1);
  assert.equal(logRes.body.entries[0].id, firstId);

  // Third attempt with same key but different reason should also be blocked (key is primary)
  const third = await request(app)
    .post('/remediation/action')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...payload, reason: 'different reason but same key' });
  assert.equal(third.statusCode, 409);
});

test('remediation: append-only - multiple actions preserve order and hash chain', async () => {
  const app = await setupApp();
  await clearAll();

  const actions = [
    { action: 'freeze_dao', target: '1', reason: 'first incident', idempotencyKey: 'append-1-' + Date.now() },
    { action: 'revoke_member', target: 'G' + 'A'.repeat(55), reason: 'remove bad actor', idempotencyKey: 'append-2-' + Date.now() },
    { action: 'unfreeze_dao', target: '1', reason: 'resolved', idempotencyKey: 'append-3-' + Date.now() },
  ];

  for (const a of actions) {
    const res = await request(app)
      .post('/remediation/action')
      .set('Authorization', `Bearer ${token}`)
      .send(a);
    assert.equal(res.statusCode, 201);
  }

  const logRes = await request(app)
    .get('/remediation/log?limit=100')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(logRes.statusCode, 200);
  assert.equal(logRes.body.total, 3);
  // Order should be insertion order
  assert.equal(logRes.body.entries[0].action, 'freeze_dao');
  assert.equal(logRes.body.entries[1].action, 'revoke_member');
  assert.equal(logRes.body.entries[2].action, 'unfreeze_dao');

  // Verify hash chain integrity
  const verifyRes = await request(app)
    .post('/remediation/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(verifyRes.statusCode, 200);
  assert.equal(verifyRes.body.valid, true);
  assert.equal(verifyRes.body.length, 3);
  assert.equal(verifyRes.body.chain.length, 3);
  // Each hash should be 64 hex chars
  for (const c of verifyRes.body.chain) {
    assert.equal(c.hash.length, 64);
  }
  assert.ok(verifyRes.body.latestHash);
});

test('remediation: validation - rejects invalid action, missing fields', async () => {
  const app = await setupApp();
  await clearAll();

  const cases = [
    [{ target: '1', reason: 'test', idempotencyKey: 'validkey123' }, /action is required/],
    [{ action: 'invalid_action', target: '1', reason: 'test reason longer', idempotencyKey: 'validkey123' }, /invalid action/],
    [{ action: 'freeze_dao', reason: 'test reason longer', idempotencyKey: 'validkey123' }, /target is required/],
    [{ action: 'freeze_dao', target: '1', reason: 'hi', idempotencyKey: 'validkey123' }, /reason must be at least/],
    [{ action: 'freeze_dao', target: '1', reason: 'valid reason longer', idempotencyKey: 'short' }, /idempotencyKey must be at least/],
  ];

  for (const [body, regex] of cases) {
    const res = await request(app)
      .post('/remediation/action')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, regex);
  }
});

test('remediation: log query requires auth and supports filters', async () => {
  const app = await setupApp();
  await clearAll();

  // Without auth
  const noAuth = await request(app).get('/remediation/log');
  assert.equal(noAuth.statusCode, 401);

  // Create two
  await request(app)
    .post('/remediation/action')
    .set('Authorization', `Bearer ${token}`)
    .send({ action: 'freeze_dao', target: '10', reason: 'test freeze', idempotencyKey: 'filter-1-' + Date.now() });
  await request(app)
    .post('/remediation/action')
    .set('Authorization', `Bearer ${token}`)
    .send({ action: 'pause_voting', target: '10', reason: 'test pause', idempotencyKey: 'filter-2-' + Date.now() });

  const filtered = await request(app)
    .get('/remediation/log?action=freeze_dao')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(filtered.statusCode, 200);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.entries[0].action, 'freeze_dao');

  const byTarget = await request(app)
    .get('/remediation/log?target=10')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(byTarget.body.total, 2);
});

test('remediation: audit log immutable - no DELETE or PUT endpoints', async () => {
  const app = await setupApp();
  await clearAll();

  const key = 'immutable-check-' + Date.now();
  const res = await request(app)
    .post('/remediation/action')
    .set('Authorization', `Bearer ${token}`)
    .send({ action: 'emergency_pause', target: '1', reason: 'emergency test', idempotencyKey: key });
  const id = res.body.remediationId;

  // Try DELETE (should 404)
  const del = await request(app)
    .delete(`/remediation/${id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(del.statusCode, 404);

  const put = await request(app)
    .put(`/remediation/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reason: 'tamper' });
  assert.equal(put.statusCode, 404);

  // Log still intact
  const logRes = await request(app)
    .get('/remediation/log')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(logRes.body.total, 1);
});
