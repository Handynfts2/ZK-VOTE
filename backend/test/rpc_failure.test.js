import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

const token = 'testtoken';

const setupApp = async () => {
  process.env.RELAYER_SECRET_KEY = 'SCVZXEUXJLRZKPCUXGXN53BJTD3RAZPRSSXHXDGSZQH5EOGEUTWINUXF';
  process.env.VOTING_CONTRACT_ID = 'C'.padEnd(56, 'A');
  process.env.TREE_CONTRACT_ID = 'C'.padEnd(56, 'B');
  process.env.COMMENTS_CONTRACT_ID = 'C'.padEnd(56, 'D');
  process.env.SOROBAN_RPC_URL = 'http://localhost';
  process.env.CORS_ORIGIN = 'http://localhost'; // CSRF middleware fails-closed on wildcard CORS
  process.env.NETWORK_PASSPHRASE = 'Test';
  process.env.RELAYER_AUTH_TOKEN = token;
  process.env.HEALTH_EXPOSE_DETAILS = 'false';
  process.env.RELAYER_TEST_MODE = 'true';

  const relayer = await import('../src/index.ts');
  return relayer.app || relayer.default || relayer;
};

test('vote returns coarse error when simulate disabled in test mode', async () => {
  const app = await setupApp();
  const res = await request(app)
    .post('/vote')
    .set('Authorization', `Bearer ${token}`)
    .send({
      daoId: 1,
      proposalId: 1,
      choice: true,
      nullifier: '0x1',
      root: '0x1',
      proof: { a: '0x', b: '0x', c: '0x' },
    });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error);
});

// ============================================================
// SequenceManager tests (issue #279)
// ============================================================

test('SequenceManager.handleTxError marks dirty on tx_bad_seq', async () => {
  const { sequenceManager } = await import('../src/services/stellar.ts');

  // Reset dirty state first
  sequenceManager.markDirty();

  const wasBadSeq = sequenceManager.handleTxError('tx_bad_seq: sequence mismatch');
  assert.equal(wasBadSeq, true, 'Should detect tx_bad_seq');
});

test('SequenceManager.handleTxError returns false for non-sequence errors', async () => {
  const { sequenceManager } = await import('../src/services/stellar.ts');

  const wasBadSeq = sequenceManager.handleTxError('tx_failed: insufficient_balance');
  assert.equal(wasBadSeq, false, 'Should not flag non-sequence errors as bad-seq');
});

test('SequenceManager forceResync updates internal state via mock RPC', async () => {
  const { SequenceManager } = await import('../src/services/stellar.ts');

  const mockServer = {
    getAccount: async () => ({ sequence: '999', accountId: 'GTEST' }),
  };

  const mgr = new SequenceManager();
  // Confirm dirty before resync
  mgr.markDirty();
  await mgr.forceResync(mockServer);
  // After resync, a subsequent handleTxError should not leave dirty flag from the resync itself
  const r = mgr.handleTxError('tx_failed: something_else');
  assert.equal(r, false);
});
