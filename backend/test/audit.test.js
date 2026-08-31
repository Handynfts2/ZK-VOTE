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

// Helper to clear audit log between tests by importing middleware
const clearAudit = async () => {
  try {
    const mod = await import('../src/middleware/audit.ts');
    if (mod.clearAuditLog) mod.clearAuditLog();
    const rem = await import('../src/routes/remediation.ts');
    if (rem.clearRemediationLog) rem.clearRemediationLog();
    if (mod.clearIdempotencyKeys) mod.clearIdempotencyKeys();
  } catch {}
};

test('audit: redaction - proof and nullifier are redacted in audit logs', async () => {
  const app = await setupApp();
  await clearAudit();

  const uniqueNullifier = '0x' + 'aa'.repeat(32);
  const res = await request(app)
    .post('/vote')
    .set('Authorization', `Bearer ${token}`)
    .send({
      daoId: 1,
      proposalId: 1,
      choice: true,
      nullifier: uniqueNullifier,
      root: '0x' + 'bb'.repeat(32),
      proof: { a: '11'.repeat(64), b: '22'.repeat(128), c: '33'.repeat(64) },
    });
  // vote in test mode returns 400 but should still be audited
  assert.ok([400, 500].includes(res.statusCode));

  // Give audit middleware a tick to write (on finish)
  await new Promise((r) => setTimeout(r, 50));

  const auditRes = await request(app)
    .get('/audit/logs')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(auditRes.statusCode, 200);
  assert.ok(auditRes.body.total >= 1);
  // Find the vote entry
  const voteEntry = auditRes.body.entries.find((e) => e.action === 'vote' || e.path === '/vote');
  assert.ok(voteEntry, 'vote audit entry should exist');
  // Check redaction
  const body = voteEntry.requestBody;
  assert.ok(body, 'audit should have requestBody');
  assert.equal(body.nullifier, '[REDACTED]', 'nullifier should be redacted');
  assert.equal(body.proof, '[REDACTED]', 'proof should be redacted');
  assert.equal(body.root, '[REDACTED]', 'root should be redacted');
  // Ensure raw values not leaked
  const bodyStr = JSON.stringify(body);
  assert.equal(bodyStr.includes(uniqueNullifier.slice(2, 10)), false, 'raw nullifier should not appear');
});

test('audit: redaction - nested sensitive fields and proof components redacted', async () => {
  const app = await setupApp();
  await clearAudit();
  const mod = await import('../src/middleware/audit.ts');
  const redacted = mod.redactPii({
    daoId: 1,
    nullifier: '0xdead',
    proof: { a: '0xaaa', b: '0xbbb', c: '0xccc' },
    nested: { secret: 'should-hide', token: 'hide-me', safe: 'visible' },
    commitment: '0x123',
  });
  assert.equal(redacted.nullifier, '[REDACTED]');
  assert.equal(redacted.proof, '[REDACTED]');
  assert.equal(redacted.commitment, '[REDACTED]');
  assert.equal(redacted.nested.secret, '[REDACTED]');
  assert.equal(redacted.nested.token, '[REDACTED]');
  assert.equal(redacted.nested.safe, 'visible');
  assert.equal(redacted.daoId, 1);
});

test('audit: query API filters by action and method', async () => {
  const app = await setupApp();
  await clearAudit();

  // Create two different mutating requests
  await request(app)
    .post('/vote')
    .set('Authorization', `Bearer ${token}`)
    .send({
      daoId: 10,
      proposalId: 1,
      choice: true,
      nullifier: '0x' + '01'.repeat(32),
      root: '0x' + '02'.repeat(32),
      proof: { a: '11'.repeat(64), b: '22'.repeat(128), c: '33'.repeat(64) },
    });
  await request(app)
    .post('/daos/sync')
    .set('Authorization', `Bearer ${token}`)
    .send({});

  await new Promise((r) => setTimeout(r, 50));

  const voteOnly = await request(app)
    .get('/audit/logs?action=vote')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(voteOnly.statusCode, 200);
  assert.ok(voteOnly.body.entries.every((e) => e.action.includes('vote')));

  const postOnly = await request(app)
    .get('/audit/logs?method=POST')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(postOnly.statusCode, 200);
  assert.ok(postOnly.body.entries.length >= 2);
  assert.ok(postOnly.body.entries.every((e) => e.method === 'POST'));
});

test('audit: query API supports limit/offset and export', async () => {
  const app = await setupApp();
  await clearAudit();

  for (let i = 0; i < 3; i++) {
    await request(app)
      .post('/vote')
      .set('Authorization', `Bearer ${token}`)
      .send({
        daoId: i,
        proposalId: 1,
        choice: true,
        nullifier: '0x' + (i + 10).toString(16).padStart(64, '0'),
        root: '0x' + '02'.repeat(32),
        proof: { a: '11'.repeat(64), b: '22'.repeat(128), c: '33'.repeat(64) },
      });
  }
  await new Promise((r) => setTimeout(r, 50));

  const limited = await request(app)
    .get('/audit/logs?limit=1&offset=1')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(limited.statusCode, 200);
  assert.equal(limited.body.entries.length, 1);
  assert.equal(limited.body.limit, 1);
  assert.equal(limited.body.offset, 1);

  const exportJson = await request(app)
    .get('/audit/export?format=json')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(exportJson.statusCode, 200);
  assert.ok(exportJson.headers['content-type'].includes('application/json'));
  // Should be parseable JSON array
  const parsed = JSON.parse(exportJson.text);
  assert.ok(Array.isArray(parsed));

  const exportCsv = await request(app)
    .get('/audit/export?format=csv')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(exportCsv.statusCode, 200);
  assert.ok(exportCsv.headers['content-type'].includes('text/csv'));
  assert.ok(exportCsv.text.includes('id,timestamp'));
});

test('audit: 100% mutating routes are audited (spot check all POST routes)', async () => {
  const app = await setupApp();
  await clearAudit();

  const mutatingRoutes = [
    { method: 'post', path: '/vote', body: { daoId: 1, proposalId: 1, choice: true, nullifier: '0x' + '01'.repeat(32), root: '0x' + '02'.repeat(32), proof: { a: '11'.repeat(64), b: '22'.repeat(128), c: '33'.repeat(64) } } },
    { method: 'post', path: '/comment/anonymous', body: { daoId: 1, proposalId: 1, contentCid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', parentId: null, voteChoice: true, nullifier: '0x' + '03'.repeat(32), root: '0x' + '04'.repeat(32), proof: { a: '11'.repeat(64), b: '22'.repeat(128), c: '33'.repeat(64) } } },
    { method: 'post', path: '/comment/edit', body: { daoId: 1, proposalId: 1, commentId: 1, newContentCid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', author: 'G' + 'A'.repeat(55) } },
    { method: 'post', path: '/comment/delete', body: { daoId: 1, proposalId: 1, commentId: 1, author: 'G' + 'A'.repeat(55) } },
    { method: 'post', path: '/bridge/vote', body: { daoId: 1, proposalId: 1, voteChoice: 1, nullifier: '0x' + '05'.repeat(32), voteRoot: '0x' + '06'.repeat(32), sbtRoot: '0x' + '07'.repeat(32), proof: { a: '11'.repeat(64), b: '22'.repeat(128), c: '33'.repeat(64) } } },
    { method: 'post', path: '/bridge/relay', body: {} },
    { method: 'post', path: '/daos/sync', body: {} },
    { method: 'post', path: '/events', body: { daoId: 1, type: 'test_event', data: {} } },
    { method: 'post', path: '/events/notify', body: { daoId: 1, type: 'vote_cast', data: {}, txHash: 'a'.repeat(64) } },
    { method: 'post', path: '/remediation/action', body: { action: 'freeze_dao', target: '1', reason: 'incident response test', idempotencyKey: 'audit-test-key-' + Date.now() } },
  ];

  for (const r of mutatingRoutes) {
    await request(app)[r.method](r.path).set('Authorization', `Bearer ${token}`).send(r.body);
  }
  await new Promise((r) => setTimeout(r, 100));

  const auditRes = await request(app)
    .get('/audit/logs?limit=100')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(auditRes.statusCode, 200);
  // At least as many entries as routes we hit
  assert.ok(auditRes.body.total >= mutatingRoutes.length, `expected >=${mutatingRoutes.length} audit entries, got ${auditRes.body.total}`);

  // Verify each path has at least one audit entry
  const paths = new Set(auditRes.body.entries.map((e) => e.path));
  for (const r of mutatingRoutes) {
    // path in audit is req.path (without query) - should match
    assert.ok(paths.has(r.path), `missing audit for ${r.path}. Seen: ${[...paths].join(', ')}`);
  }

  // Verify redaction on every entry that had sensitive fields
  const sensitiveEntries = auditRes.body.entries.filter((e) => e.requestBody && typeof e.requestBody === 'object');
  for (const e of sensitiveEntries) {
    const str = JSON.stringify(e.requestBody);
    // Should not contain raw hex proof components like '11'.repeat(20) raw
    // But at least ensure 'proof' field if present is redacted
    if ('proof' in e.requestBody) {
      assert.equal(e.requestBody.proof, '[REDACTED]', `proof not redacted for ${e.path}`);
    }
    if ('nullifier' in e.requestBody) {
      assert.equal(e.requestBody.nullifier, '[REDACTED]');
    }
  }
});

test('audit: query and export require auth (authz)', async () => {
  const app = await setupApp();
  const res1 = await request(app).get('/audit/logs');
  assert.equal(res1.statusCode, 401);
  const res2 = await request(app).get('/audit/export?format=json');
  assert.equal(res2.statusCode, 401);
  const res3 = await request(app).get('/audit/stats');
  assert.equal(res3.statusCode, 401);
});

test('audit: openapi spec documents audited routes', async () => {
  const app = await setupApp();
  const res = await request(app).get('/openapi.json');
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.paths['/vote']);
  assert.ok(res.body.paths['/audit/logs']);
  assert.ok(res.body.paths['/remediation/action']);
  assert.equal(res.body.paths['/vote'].post['x-audited'], true);
  assert.ok(res.body['x-audit'].mutatingRoutes.includes('POST /vote'));
});
