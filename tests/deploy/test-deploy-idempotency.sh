#!/bin/bash
# Test suite for deployment idempotency and ordering

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
DEPLOY_LIB="$REPO_ROOT/scripts/deploy/lib/deploy-state.sh"

# Test state file
TEST_STATE="/tmp/test-deploy-state.json"

# Override state file for tests
export DEPLOY_STATE_FILE="$TEST_STATE"

# Source the deploy state functions
source "$DEPLOY_LIB"

# Helper: cleanup test state
cleanup_test_state() {
  rm -f "$TEST_STATE"
}

# Helper: assert function
assert_equal() {
  local actual="$1"
  local expected="$2"
  local message="${3:-Assertion failed}"

  if [ "$actual" != "$expected" ]; then
    echo "❌ FAIL: $message"
    echo "  Expected: $expected"
    echo "  Got: $actual"
    exit 1
  else
    echo "✓ PASS: $message"
  fi
}

# Helper: assert not empty
assert_not_empty() {
  local value="$1"
  local message="${2:-Value should not be empty}"

  if [ -z "$value" ]; then
    echo "❌ FAIL: $message"
    exit 1
  else
    echo "✓ PASS: $message"
  fi
}

# Test 1: Init state creates file
test_init_state() {
  echo ""
  echo "Test 1: Initialization creates state file"
  cleanup_test_state

  init_state
  assert_equal "$([ -f $TEST_STATE ] && echo yes || echo no)" "yes" "State file created"
  assert_not_empty "$(cat $TEST_STATE)" "State file is not empty"
}

# Test 2: is_deployed returns false for undeployed contract
test_not_deployed() {
  echo ""
  echo "Test 2: is_deployed returns false for undeployed contract"
  cleanup_test_state
  init_state

  if is_deployed "dao_registry"; then
    echo "❌ FAIL: dao_registry should not be deployed yet"
    exit 1
  else
    echo "✓ PASS: dao_registry correctly detected as not deployed"
  fi
}

# Test 3: Save and retrieve contract ID
test_save_and_retrieve() {
  echo ""
  echo "Test 3: Save and retrieve contract ID"
  cleanup_test_state
  init_state

  local test_id="CABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC"
  save_contract_id "dao_registry" "$test_id" "2026-08-26T00:00:00Z"

  local retrieved=$(get_contract_id "dao_registry")
  assert_equal "$retrieved" "$test_id" "Contract ID retrieved correctly"
}

# Test 4: is_deployed returns true after save
test_is_deployed_after_save() {
  echo ""
  echo "Test 4: is_deployed returns true after save"
  cleanup_test_state
  init_state

  local test_id="CABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC"
  save_contract_id "dao_registry" "$test_id" "2026-08-26T00:00:00Z"

  if is_deployed "dao_registry"; then
    echo "✓ PASS: dao_registry correctly detected as deployed"
  else
    echo "❌ FAIL: dao_registry should be deployed after save"
    exit 1
  fi
}

# Test 5: Dependency order verification - valid order
test_valid_dependency_order() {
  echo ""
  echo "Test 5: Dependency order verification (valid order)"
  cleanup_test_state
  init_state

  # Deploy in correct order
  local id1="CABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC"
  local id2="CBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCD"
  local id3="CCCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDE"

  save_contract_id "dao_registry" "$id1" "2026-08-26T00:00:00Z"
  save_contract_id "membership_sbt" "$id2" "2026-08-26T00:01:00Z"
  save_contract_id "membership_tree" "$id3" "2026-08-26T00:02:00Z"

  if verify_dependency_order; then
    echo "✓ PASS: Valid deployment order accepted"
  else
    echo "❌ FAIL: Valid deployment order should pass verification"
    exit 1
  fi
}

# Test 6: Dependency order verification - invalid order detection
test_invalid_dependency_order() {
  echo ""
  echo "Test 6: Dependency order verification (invalid order detection)"
  cleanup_test_state
  init_state

  # Try to deploy membership_sbt without dao_registry
  local id="CABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC"
  save_contract_id "membership_sbt" "$id" "2026-08-26T00:00:00Z"

  if verify_dependency_order > /dev/null 2>&1; then
    echo "❌ FAIL: Invalid order should be detected (sbt without registry)"
    exit 1
  else
    echo "✓ PASS: Invalid order correctly detected"
  fi
}

# Test 7: get_next_contract returns correct order
test_next_contract_order() {
  echo ""
  echo "Test 7: get_next_contract returns correct order"
  cleanup_test_state
  init_state

  next=$(get_next_contract)
  assert_equal "$next" "dao_registry" "First contract should be dao_registry"

  # Deploy registry
  save_contract_id "dao_registry" "CABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC" "2026-08-26T00:00:00Z"

  next=$(get_next_contract)
  assert_equal "$next" "membership_sbt" "Second contract should be membership_sbt"

  # Deploy sbt and tree
  save_contract_id "membership_sbt" "CBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCD" "2026-08-26T00:01:00Z"
  save_contract_id "membership_tree" "CCCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDE" "2026-08-26T00:02:00Z"

  next=$(get_next_contract)
  assert_equal "$next" "voting" "Third contract should be voting"
}

# Test 8: Idempotency - re-running returns same state
test_idempotency() {
  echo ""
  echo "Test 8: Idempotency (re-running returns same state)"
  cleanup_test_state
  init_state

  # First deployment
  local id1="CABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC"
  save_contract_id "dao_registry" "$id1" "2026-08-26T00:00:00Z"
  local first_get=$(get_contract_id "dao_registry")

  # "Re-deploy" without changing state
  init_state
  local second_get=$(get_contract_id "dao_registry")

  assert_equal "$first_get" "$second_get" "Contract ID unchanged after re-init (idempotent)"
  assert_equal "$second_get" "$id1" "Contract ID still correct"
}

# Test 9: Dry-run plan shows correct output
test_dry_run_plan() {
  echo ""
  echo "Test 9: Dry-run plan shows deployment order"
  cleanup_test_state
  init_state

  output=$(print_deploy_plan)

  if echo "$output" | grep -q "1. Deploy dao_registry"; then
    echo "✓ PASS: Dry-run shows dao_registry as deployable"
  else
    echo "❌ FAIL: Dry-run should show dao_registry"
    exit 1
  fi

  # Deploy registry, should show as skipped
  save_contract_id "dao_registry" "CABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC" "2026-08-26T00:00:00Z"
  output=$(print_deploy_plan)

  if echo "$output" | grep -q "1. Skip dao_registry"; then
    echo "✓ PASS: Dry-run shows dao_registry as already deployed"
  else
    echo "❌ FAIL: Dry-run should show dao_registry as skipped"
    exit 1
  fi
}

# Test 10: Valid contract ID format
test_valid_contract_id_format() {
  echo ""
  echo "Test 10: Valid contract ID format check"

  local valid_id="CABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC"
  local invalid_id1="XABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC"
  local invalid_id2="CABCDEF"

  if is_valid_contract_id "$valid_id"; then
    echo "✓ PASS: Valid contract ID accepted"
  else
    echo "❌ FAIL: Valid contract ID should be accepted"
    exit 1
  fi

  if ! is_valid_contract_id "$invalid_id1"; then
    echo "✓ PASS: Invalid contract ID (wrong prefix) rejected"
  else
    echo "❌ FAIL: Invalid ID should be rejected"
    exit 1
  fi

  if ! is_valid_contract_id "$invalid_id2"; then
    echo "✓ PASS: Invalid contract ID (too short) rejected"
  else
    echo "❌ FAIL: Invalid ID should be rejected"
    exit 1
  fi
}

# Run all tests
echo "========================================="
echo "   Deployment State Management Tests"
echo "========================================="

test_init_state
test_not_deployed
test_save_and_retrieve
test_is_deployed_after_save
test_valid_dependency_order
test_invalid_dependency_order
test_next_contract_order
test_idempotency
test_dry_run_plan
test_valid_contract_id_format

cleanup_test_state

echo ""
echo "========================================="
echo "   ✓ All tests passed!"
echo "========================================="
