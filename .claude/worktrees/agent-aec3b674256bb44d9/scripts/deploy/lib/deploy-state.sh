#!/bin/bash
# deploy-state.sh
#
# Shared helpers for making the ZKVote deploy scripts idempotent.
#
# Contracts must be deployed in dependency order because each later
# contract is constructed with the address of an earlier one:
#
#   dao-registry
#     -> membership-sbt   (needs registry)
#     -> membership-tree  (needs sbt, registry)
#     -> voting           (needs tree, registry)
#     -> comments          (needs tree, voting, registry)
#
# This file is sourced (not executed) by the deploy scripts. It is also
# sourced directly by tests/deploy/*.sh, so every function here must be
# safe to call without a live network - all "is this contract already
# deployed" checks go through the injectable CONTRACT_EXISTS_CHECK hook
# instead of calling `stellar` directly.

# Canonical dependency order. Exported as a plain array so callers/tests
# can iterate over it.
DEPLOY_CONTRACT_ORDER=(dao-registry membership-sbt membership-tree voting comments)

# Where deployed contract ids are recorded. Overridable so tests can point
# this at a scratch file instead of the real deployment state.
DEPLOY_STATE_FILE="${DEPLOY_STATE_FILE:-scripts/deploy/deployed-contracts.json}"

# Hook used to decide whether a contract that is recorded in the state
# file actually still exists on-chain. Deploy scripts overwrite this with
# a real `stellar contract info` (or similar) check; tests overwrite it
# with a stub. Default: trust the state file.
if [ -z "${CONTRACT_EXISTS_CHECK:-}" ]; then
  contract_exists_check() {
    # args: contract_name contract_id
    return 0
  }
else
  contract_exists_check() { "$CONTRACT_EXISTS_CHECK" "$@"; }
fi

deploy_state_log() {
  echo "$1" >&2
}

# Ensure the state file exists and contains a minimal valid JSON object.
deploy_state_init() {
  local dir
  dir="$(dirname "$DEPLOY_STATE_FILE")"
  [ -d "$dir" ] || mkdir -p "$dir"
  if [ ! -f "$DEPLOY_STATE_FILE" ]; then
    echo '{}' > "$DEPLOY_STATE_FILE"
  fi
}

# Print the contract id recorded for a given contract name, or nothing.
deploy_state_get() {
  local name="$1"
  [ -f "$DEPLOY_STATE_FILE" ] || return 0
  jq -r --arg n "$name" '.[$n].id // empty' "$DEPLOY_STATE_FILE" 2>/dev/null
}

# Returns 0 (true) if the contract is recorded AND passes the existence
# check, i.e. deployment of it can be safely skipped.
deploy_state_is_deployed() {
  local name="$1"
  local id
  id="$(deploy_state_get "$name")"
  [ -n "$id" ] || return 1
  contract_exists_check "$name" "$id" || return 1
  return 0
}

# Record a contract id in the state file. No-ops under dry-run.
deploy_state_set() {
  local name="$1"
  local id="$2"

  if [ "${DRY_RUN:-false}" = "true" ]; then
    deploy_state_log "[dry-run] would record $name -> $id in $DEPLOY_STATE_FILE"
    return 0
  fi

  deploy_state_init
  local tmp
  tmp="$(mktemp)"
  jq --arg n "$name" --arg id "$id" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.[$n] = {id: $id, deployedAt: $ts}' \
    "$DEPLOY_STATE_FILE" > "$tmp" && mv "$tmp" "$DEPLOY_STATE_FILE"
}

# Verify that every contract *before* `name` in DEPLOY_CONTRACT_ORDER is
# already deployed. Caller should treat a non-zero return as fatal.
deploy_state_check_order() {
  local name="$1"
  local dep
  for dep in "${DEPLOY_CONTRACT_ORDER[@]}"; do
    if [ "$dep" = "$name" ]; then
      return 0
    fi
    if ! deploy_state_is_deployed "$dep"; then
      echo "ERROR: cannot deploy '$name' before its dependency '$dep' has been deployed." >&2
      echo "       Deploy contracts in order: ${DEPLOY_CONTRACT_ORDER[*]}" >&2
      return 1
    fi
  done
  echo "ERROR: unknown contract '$name' - not part of DEPLOY_CONTRACT_ORDER (${DEPLOY_CONTRACT_ORDER[*]})" >&2
  return 1
}

# Wraps a deploy step with idempotency + order checking.
#
# Usage:
#   deploy_step <name> <deploy_fn>
# where <deploy_fn> is a function name that, when called, performs the
# real deployment and echoes the resulting contract id on stdout.
#
# Prints the contract id (existing or freshly deployed) on stdout.
deploy_step() {
  local name="$1"
  local deploy_fn="$2"

  if ! deploy_state_check_order "$name"; then
    return 1
  fi

  if deploy_state_is_deployed "$name"; then
    local existing
    existing="$(deploy_state_get "$name")"
    deploy_state_log "-> $name already deployed ($existing), skipping"
    echo "$existing"
    return 0
  fi

  if [ "${DRY_RUN:-false}" = "true" ]; then
    deploy_state_log "[dry-run] would deploy $name"
    echo "DRYRUN_${name//-/_}_ID"
    return 0
  fi

  local id
  id="$("$deploy_fn")"
  if [ -z "$id" ]; then
    echo "ERROR: deployment of '$name' produced no contract id" >&2
    return 1
  fi
  deploy_state_set "$name" "$id"
  echo "$id"
}
