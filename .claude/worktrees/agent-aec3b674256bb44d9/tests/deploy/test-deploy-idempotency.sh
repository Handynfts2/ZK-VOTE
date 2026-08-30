#!/bin/bash
# test-deploy-idempotency.sh
#
# Plain bash test harness for scripts/deploy/lib/deploy-state.sh.
# No bats in this repo, so tests follow the assert-and-report style used
# elsewhere under tests/. Run directly:
#
#   bash tests/deploy/test-deploy-idempotency.sh
#
# Every check runs against a throwaway state file and a stubbed
# contract-existence check, so no network access or `stellar` CLI is
# required.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$REPO_ROOT/scripts/deploy/lib/deploy-state.sh"

RESULTS_DIR="$(mktemp -d)"
trap 'rm -rf "$RESULTS_DIR"' EXIT
echo 0 > "$RESULTS_DIR/pass"
echo 0 > "$RESULTS_DIR/fail"

# pass/fail are called from inside subshells ( ... ) below, so counters
# are tracked via files rather than plain variables.
pass() {
  local n
  n=$(cat "$RESULTS_DIR/pass")
  echo $((n + 1)) > "$RESULTS_DIR/pass"
  echo "  ok - $1"
}
fail() {
  local n
  n=$(cat "$RESULTS_DIR/fail")
  echo $((n + 1)) > "$RESULTS_DIR/fail"
  echo "  NOT OK - $1"
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$desc"
  else
    fail "$desc (expected '$expected', got '$actual')"
  fi
}

assert_status() {
  local desc="$1" expected_status="$2"
  shift 2
  local actual_status=0
  "$@" >/tmp/deploy-test-out.$$ 2>&1 || actual_status=$?
  rm -f "/tmp/deploy-test-out.$$"
  if [ "$expected_status" = "$actual_status" ]; then
    pass "$desc"
  else
    fail "$desc (expected exit $expected_status, got $actual_status)"
  fi
}

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR" "$RESULTS_DIR"' EXIT

fresh_state_file() {
  echo "$WORKDIR/deployed-contracts.$$.$RANDOM.json"
}

echo "=== deploy-state.sh: idempotent re-run is a no-op ==="
(
  DEPLOY_STATE_FILE="$(fresh_state_file)"
  export DEPLOY_STATE_FILE DRY_RUN=false
  # shellcheck source=/dev/null
  source "$LIB"

  CALL_COUNT_FILE="$WORKDIR/call-count"
  echo 0 > "$CALL_COUNT_FILE"

  deploy_dao_registry_stub() {
    local n
    n=$(cat "$CALL_COUNT_FILE")
    echo $((n + 1)) > "$CALL_COUNT_FILE"
    echo "CDUMMYREGISTRYID0000000000000000000000000000000000000"
  }

  first_id="$(deploy_step "dao-registry" deploy_dao_registry_stub)"
  second_id="$(deploy_step "dao-registry" deploy_dao_registry_stub)"
  calls="$(cat "$CALL_COUNT_FILE")"

  assert_eq "first deploy returns a contract id" "CDUMMYREGISTRYID0000000000000000000000000000000000000" "$first_id"
  assert_eq "second deploy returns the same id" "$first_id" "$second_id"
  assert_eq "underlying deploy function only invoked once" "1" "$calls"
)

echo ""
echo "=== deploy-state.sh: dependency order is enforced ==="
(
  DEPLOY_STATE_FILE="$(fresh_state_file)"
  export DEPLOY_STATE_FILE DRY_RUN=false
  # shellcheck source=/dev/null
  source "$LIB"

  deploy_voting_stub() { echo "CDUMMYVOTINGID000000000000000000000000000000000000000"; }

  assert_status "deploying 'voting' before its dependencies fails" 1 \
    bash -c "DEPLOY_STATE_FILE='$DEPLOY_STATE_FILE' source '$LIB'; deploy_step voting deploy_voting_stub"

  # State file must remain untouched by the failed attempt.
  if [ ! -f "$DEPLOY_STATE_FILE" ] || [ "$(jq -r '.voting.id // empty' "$DEPLOY_STATE_FILE" 2>/dev/null)" = "" ]; then
    pass "state file has no 'voting' entry after the out-of-order failure"
  else
    fail "state file unexpectedly recorded 'voting'"
  fi

  # Now deploy in the correct order and confirm voting succeeds.
  deploy_dao_registry_stub() { echo "CREGISTRY000000000000000000000000000000000000000000000" | cut -c1-56; }
  deploy_sbt_stub() { echo "CSBT00000000000000000000000000000000000000000000000000" | cut -c1-56; }
  deploy_tree_stub() { echo "CTREE0000000000000000000000000000000000000000000000000" | cut -c1-56; }

  deploy_step "dao-registry" deploy_dao_registry_stub >/dev/null
  deploy_step "membership-sbt" deploy_sbt_stub >/dev/null
  deploy_step "membership-tree" deploy_tree_stub >/dev/null
  voting_id="$(deploy_step "voting" deploy_voting_stub)"

  assert_eq "voting deploys once its dependencies are in place" \
    "CDUMMYVOTINGID000000000000000000000000000000000000000" "$voting_id"
)

echo ""
echo "=== deploy-state.sh: --dry-run does not mutate state ==="
(
  DEPLOY_STATE_FILE="$(fresh_state_file)"
  export DEPLOY_STATE_FILE

  # No state file should exist yet.
  DRY_RUN=true
  export DRY_RUN
  # shellcheck source=/dev/null
  source "$LIB"

  deploy_dao_registry_stub() { echo "SHOULD_NOT_BE_CALLED"; }

  dry_run_id="$(deploy_step "dao-registry" deploy_dao_registry_stub)"

  if [ -f "$DEPLOY_STATE_FILE" ]; then
    fail "dry-run created a state file at $DEPLOY_STATE_FILE"
  else
    pass "dry-run created no state file"
  fi

  case "$dry_run_id" in
    DRYRUN_*)
      pass "dry-run returns a placeholder id instead of deploying"
      ;;
    *)
      fail "dry-run returned unexpected id '$dry_run_id'"
      ;;
  esac

  # Now seed real state (dry-run off) and confirm a subsequent dry-run
  # still performs no writes even when contracts already exist.
  DRY_RUN=false
  deploy_dao_registry_real() { echo "CREALREGISTRYID00000000000000000000000000000000000000"; }
  deploy_step "dao-registry" deploy_dao_registry_real >/dev/null
  BEFORE_HASH="$(sha256sum "$DEPLOY_STATE_FILE" | awk '{print $1}')"

  DRY_RUN=true
  deploy_sbt_stub() { echo "SHOULD_NOT_BE_CALLED_EITHER"; }
  deploy_step "membership-sbt" deploy_sbt_stub >/dev/null
  AFTER_HASH="$(sha256sum "$DEPLOY_STATE_FILE" | awk '{print $1}')"

  assert_eq "dry-run leaves an existing state file byte-for-byte unchanged" "$BEFORE_HASH" "$AFTER_HASH"
)

echo ""
echo "=== deploy-state.sh: on-chain existence check can force redeploy ==="
(
  DEPLOY_STATE_FILE="$(fresh_state_file)"
  export DEPLOY_STATE_FILE DRY_RUN=false

  # Simulate a contract that was recorded locally but no longer exists
  # on-chain (e.g. after a network reset) - the exists check returns
  # false, so deploy_step must redeploy rather than trusting the file.
  always_missing_check() { return 1; }
  CONTRACT_EXISTS_CHECK=always_missing_check
  export CONTRACT_EXISTS_CHECK
  # shellcheck source=/dev/null
  source "$LIB"

  CALL_COUNT_FILE="$WORKDIR/exists-check-call-count"
  echo 0 > "$CALL_COUNT_FILE"
  deploy_dao_registry_stub() {
    local n
    n=$(cat "$CALL_COUNT_FILE")
    echo $((n + 1)) > "$CALL_COUNT_FILE"
    echo "CFRESHREGISTRYID0000000000000000000000000000000000000"
  }

  deploy_step "dao-registry" deploy_dao_registry_stub >/dev/null
  deploy_step "dao-registry" deploy_dao_registry_stub >/dev/null
  CALLS="$(cat "$CALL_COUNT_FILE")"

  assert_eq "redeploys when the existence check reports the contract gone" "2" "$CALLS"
)

PASS="$(cat "$RESULTS_DIR/pass")"
FAIL="$(cat "$RESULTS_DIR/fail")"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
exit 0
