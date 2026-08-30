#!/bin/bash
# End-to-End Poseidon KAT Test
#
# Verifies circomlib and P25 Poseidon implementations are compatible
# by deploying contracts to local P25 testnet and comparing Merkle roots.
#
# CRITICAL: Run this BEFORE production deployment!
#
# Prerequisites:
# - Docker running
# - Stellar CLI with P25 support

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export NODE_PATH="$PROJECT_ROOT/frontend/node_modules"

echo "============================================"
echo "Poseidon KAT End-to-End Verification"
echo "============================================"
echo ""
echo "This test verifies that circomlib Poseidon and P25 host function"
echo "produce identical results. If they don't match, the system is broken."
echo ""

# Check prerequisites
command -v stellar >/dev/null 2>&1 || { echo "ERROR: stellar CLI not found"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found"; exit 1; }

# Step 1: Start local P25 testnet
echo "Step 1: Starting local P25 testnet..."
stellar container start -t future 2>/dev/null || {
    echo "  Container already running or starting..."
}

# Wait for network
echo "  Waiting for network to be ready..."
sleep 5

# Check network health
if ! curl -s --max-time 5 http://localhost:8000/health > /dev/null 2>&1; then
    echo "  ERROR: Network not responding. Please ensure Docker is running."
    exit 1
fi
echo "  Network is ready."
echo ""

# Network configuration - use explicit parameters
RPC_URL="http://localhost:8000/soroban/rpc"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"

# Step 2: Create and fund test key
echo "Step 2: Creating test account..."
KEY_NAME="kat-test-$(date +%s)"
stellar keys generate "$KEY_NAME" 2>/dev/null || true
PUBKEY=$(stellar keys address "$KEY_NAME")
echo "  Public key: $PUBKEY"

stellar keys fund "$KEY_NAME" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE"
echo "  Account funded."
echo ""

# Step 3: Build contracts
echo "Step 3: Building contracts..."
cd "$PROJECT_ROOT"
cargo build --target wasm32v1-none --release -p dao-registry -p membership-sbt -p membership-tree 2>&1 | tail -5
echo "  Contracts built."
echo ""

# Step 4: Deploy contracts with constructors
echo "Step 4: Deploying contracts..."

REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/dao_registry.wasm \
  --source "$KEY_NAME" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" 2>&1 | tail -1)
echo "  DAORegistry: $REGISTRY_ID"

SBT_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_sbt.wasm \
  --source "$KEY_NAME" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" \
  -- --registry "$REGISTRY_ID" 2>&1 | tail -1)
echo "  MembershipSBT: $SBT_ID"

TREE_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_tree.wasm \
  --source "$KEY_NAME" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" \
  -- --sbt_contract "$SBT_ID" --registry "$REGISTRY_ID" 2>&1 | tail -1)
echo "  MembershipTree: $TREE_ID"
echo ""

# Step 5: Contracts initialized via CAP-0058 constructors at deploy time

# Step 6: Create test DAO
echo "Step 5: Creating test DAO..."
DAO_ID=$(stellar contract invoke \
  --id "$REGISTRY_ID" \
  --source "$KEY_NAME" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- create_dao \
  --name "KAT Test DAO" \
  --creator "$PUBKEY" 2>&1 | tail -1 | tr -d '"')
echo "  DAO ID: $DAO_ID"
echo ""

# Step 7: Initialize tree for this DAO
echo "Step 6: Initializing Merkle tree..."
stellar contract invoke \
  --id "$TREE_ID" \
  --source "$KEY_NAME" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- init_tree \
  --dao_id "$DAO_ID" \
  --depth 18 \
  --admin "$PUBKEY" 2>&1 | tail -3
echo "  Tree initialized with depth 18."
echo ""

# Step 8: Mint SBT for test member
echo "Step 7: Minting SBT..."
stellar contract invoke \
  --id "$SBT_ID" \
  --source "$KEY_NAME" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- mint \
  --dao_id "$DAO_ID" \
  --to "$PUBKEY" \
  --admin "$PUBKEY" 2>&1 | tail -3
echo "  SBT minted."
echo ""

# Step 9: Register known commitment
echo "Step 8: Registering test commitment..."
# From circomlib: Poseidon(12345, 67890) = 0x1914879b2a4e7f9555f3eb55837243cefb1366a692794a7e5b5b3181fb14b49b
# Passed to the contract as a single u256 decimal integer.
COMMITMENT_DEC=$(node -e "console.log(BigInt('0x1914879b2a4e7f9555f3eb55837243cefb1366a692794a7e5b5b3181fb14b49b').toString())")

stellar contract invoke \
  --id "$TREE_ID" \
  --source "$KEY_NAME" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- register_with_caller \
  --dao_id "$DAO_ID" \
  --commitment "$COMMITMENT_DEC" \
  --caller "$PUBKEY" 2>&1 | tail -3
echo "  Commitment registered."
echo ""

# Step 10: Get current root
echo "Step 9: Getting current Merkle root..."
ACTUAL_ROOT=$(stellar contract invoke \
  --id "$TREE_ID" \
  --source "$KEY_NAME" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- current_root \
  --dao_id "$DAO_ID" 2>&1 | tail -1)
echo "  Actual root (from P25): $ACTUAL_ROOT"
echo ""

# Step 11: Compare with expected
echo "Step 10: Comparing with circomlib expected value..."
# Expected root: Merkle root of a single-leaf (Poseidon(12345,67890)) tree at
# depth 18, computed with circomlib Poseidon — the same library the circuit uses.
# The P25 host function must produce an identical root for the KAT to pass.
EXPECTED_ROOT_DEC=$(node -e "
const { buildPoseidon } = require('circomlibjs');
(async () => {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  // Use the plain-array / F.zero API (matches circuits/utils/poseidon_kat.js).
  const leaf = poseidon([12345n, 67890n]);
  const zh = [F.zero];
  for (let i = 0; i < 18; i++) { zh.push(poseidon([zh[i], zh[i]])); }
  let node = leaf;
  for (let l = 0; l < 18; l++) { node = poseidon([node, zh[l]]); }
  console.log(F.toString(node));
})();
")
echo "  Expected root (from circomlib): $EXPECTED_ROOT_DEC"
echo ""

# Step 10b: Rust prover Poseidon KAT (must match circomlib for the same vector)
# The zkvote-prover Rust Poseidon must agree with circomlib on the on-chain
# commitment Poseidon(12345, 67890) = 0x1914879b... (see poseidon_commitment_12345_67890).
echo "Step 10b: Verifying Rust zkvote-prover Poseidon matches circomlib..."
if (cd "$PROJECT_ROOT" && cargo test -q -p zkvote-prover poseidon_commitment_12345_67890 > /tmp/rust_poseidon_kat.log 2>&1); then
    if grep -qE "1 passed" /tmp/rust_poseidon_kat.log; then
        echo "  ✅ Rust Poseidon matches circomlib for Poseidon(12345, 67890)"
    else
        echo "  ❌ Rust Poseidon KAT: test did not execute (filter mismatch)"
        cat /tmp/rust_poseidon_kat.log
        exit 1
    fi
else
    echo "  ❌ Rust Poseidon KAT FAILED: zkvote-prover Poseidon disagrees with circomlib"
    cat /tmp/rust_poseidon_kat.log
    exit 1
fi
echo ""

# Parse and compare (normalize both sides to a decimal u256)
ACTUAL_ROOT_CLEAN=$(echo "$ACTUAL_ROOT" | tr -d '"' | tr -d ' ')
if [[ "$ACTUAL_ROOT_CLEAN" == 0x* ]]; then
  ACTUAL_ROOT_CLEAN=$(node -e "console.log(BigInt('$ACTUAL_ROOT_CLEAN').toString())")
fi
if [ "$ACTUAL_ROOT_CLEAN" = "$EXPECTED_ROOT_DEC" ]; then
    echo "============================================"
    echo "✅ SUCCESS: Poseidon KAT PASSED!"
    echo "============================================"
    echo ""
    echo "Circomlib and P25 Poseidon implementations produce IDENTICAL results."
    echo "Safe to proceed with deployment."
else
    echo "============================================"
    echo "❌ FAILURE: Poseidon KAT FAILED!"
    echo "============================================"
    echo ""
    echo "Circomlib and P25 Poseidon implementations DO NOT MATCH!"
    echo ""
    echo "Expected: $EXPECTED_ROOT"
    echo "Actual:   $ACTUAL_ROOT"
    echo ""
    echo "DO NOT DEPLOY - the system will not work correctly."
    echo "Check Poseidon parameters (rounds, constants, field) in both implementations."
    exit 1
fi

# Cleanup
echo "Cleaning up test key..."
stellar keys remove "$KEY_NAME" 2>/dev/null || true

echo ""
echo "KAT test complete."
