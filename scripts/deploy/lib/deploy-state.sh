#!/bin/bash
# Deployment state management for idempotent deploys
# Maintains deployed-contracts.json to track contract IDs across deployments

DEPLOY_STATE_FILE="${DEPLOY_STATE_FILE:-.deploy-contracts.json}"

# Initialize state file if it doesn't exist
init_state() {
  if [ ! -f "$DEPLOY_STATE_FILE" ]; then
    cat > "$DEPLOY_STATE_FILE" <<'EOF'
{
  "timestamp": null,
  "network": null,
  "key_name": null,
  "contracts": {
    "dao_registry": null,
    "membership_sbt": null,
    "membership_tree": null,
    "voting": null,
    "comments": null,
    "circuit_registry": null
  },
  "deployment_history": []
}
EOF
  fi
}

# Get a contract ID from state
get_contract_id() {
  local contract_name="$1"
  init_state
  grep -o "\"$contract_name\":\s*\"[^\"]*\"" "$DEPLOY_STATE_FILE" | cut -d'"' -f4
}

# Save a contract ID to state
save_contract_id() {
  local contract_name="$1"
  local contract_id="$2"
  local timestamp="$3"

  init_state

  # Use sed to update the contract ID
  # This is a simple approach - for prod, consider using jq
  sed -i.bak "s/\"$contract_name\":\s*null/\"$contract_name\": \"$contract_id\"/" "$DEPLOY_STATE_FILE"

  # Update timestamp
  sed -i.bak "s/\"timestamp\":\s*null/\"timestamp\": \"$timestamp\"/" "$DEPLOY_STATE_FILE"

  rm -f "$DEPLOY_STATE_FILE.bak"
}

# Check if a contract is already deployed
is_deployed() {
  local contract_name="$1"
  local contract_id=$(get_contract_id "$contract_name")

  if [ -z "$contract_id" ] || [ "$contract_id" = "null" ]; then
    return 1  # Not deployed
  fi

  # Optionally verify on-chain (this would require an RPC call)
  return 0  # Already deployed
}

# Verify contract ID format
is_valid_contract_id() {
  local id="$1"
  [[ "$id" =~ ^C[A-Z0-9]{55}$ ]]
}

# Verify dependency order
verify_dependency_order() {
  # Dependency graph:
  # - dao_registry: no deps
  # - membership_sbt: needs dao_registry
  # - membership_tree: needs membership_sbt, dao_registry
  # - voting: needs membership_tree, dao_registry
  # - comments: needs voting, membership_tree, dao_registry

  local registry=$(get_contract_id "dao_registry")
  local sbt=$(get_contract_id "membership_sbt")
  local tree=$(get_contract_id "membership_tree")
  local voting=$(get_contract_id "voting")
  local comments=$(get_contract_id "comments")

  local errors=0

  # Check each dependency
  if [ -n "$sbt" ] && [ -z "$registry" ]; then
    echo "ERROR: membership_sbt deployed but dao_registry not deployed"
    errors=$((errors + 1))
  fi

  if [ -n "$tree" ] && ([ -z "$sbt" ] || [ -z "$registry" ]); then
    echo "ERROR: membership_tree deployed but dependencies missing (sbt: $sbt, registry: $registry)"
    errors=$((errors + 1))
  fi

  if [ -n "$voting" ] && ([ -z "$tree" ] || [ -z "$registry" ]); then
    echo "ERROR: voting deployed but dependencies missing"
    errors=$((errors + 1))
  fi

  if [ -n "$comments" ] && ([ -z "$voting" ] || [ -z "$tree" ]); then
    echo "ERROR: comments deployed but dependencies missing"
    errors=$((errors + 1))
  fi

  return $errors
}

# Get next contract to deploy in dependency order
get_next_contract() {
  # Returns the first undeployed contract in dependency order

  if ! is_deployed "dao_registry"; then
    echo "dao_registry"
    return 0
  fi

  if ! is_deployed "membership_sbt"; then
    echo "membership_sbt"
    return 0
  fi

  if ! is_deployed "membership_tree"; then
    echo "membership_tree"
    return 0
  fi

  if ! is_deployed "voting"; then
    echo "voting"
    return 0
  fi

  if ! is_deployed "comments"; then
    echo "comments"
    return 0
  fi

  # All deployed
  echo "all_deployed"
  return 0
}

# Print current state
print_state() {
  init_state
  echo "=== Current Deployment State ==="
  echo "State file: $DEPLOY_STATE_FILE"
  echo ""
  echo "Deployed Contracts:"

  for contract in dao_registry membership_sbt membership_tree voting comments circuit_registry; do
    local id=$(get_contract_id "$contract")
    if [ -z "$id" ] || [ "$id" = "null" ]; then
      echo "  $contract: NOT DEPLOYED"
    else
      echo "  $contract: $id"
    fi
  done
}

# Generate dry-run output
print_deploy_plan() {
  echo "=== Deployment Plan (Dry Run) ==="
  echo "State file: $DEPLOY_STATE_FILE"
  echo ""

  local registry=$(get_contract_id "dao_registry")
  local sbt=$(get_contract_id "membership_sbt")
  local tree=$(get_contract_id "membership_tree")
  local voting=$(get_contract_id "voting")
  local comments=$(get_contract_id "comments")

  echo "Deployment order (skip already deployed):"

  if [ -z "$registry" ]; then
    echo "1. Deploy dao_registry (no deps)"
  else
    echo "1. Skip dao_registry (already: $registry)"
  fi

  if [ -z "$sbt" ]; then
    echo "2. Deploy membership_sbt (deps: dao_registry)"
  else
    echo "2. Skip membership_sbt (already: $sbt)"
  fi

  if [ -z "$tree" ]; then
    echo "3. Deploy membership_tree (deps: dao_registry, membership_sbt)"
  else
    echo "3. Skip membership_tree (already: $tree)"
  fi

  if [ -z "$voting" ]; then
    echo "4. Deploy voting (deps: dao_registry, membership_tree)"
  else
    echo "4. Skip voting (already: $voting)"
  fi

  if [ -z "$comments" ]; then
    echo "5. Deploy comments (deps: dao_registry, membership_tree, voting)"
  else
    echo "5. Skip comments (already: $comments)"
  fi
}

# Export functions for sourcing
export -f init_state
export -f get_contract_id
export -f save_contract_id
export -f is_deployed
export -f is_valid_contract_id
export -f verify_dependency_order
export -f get_next_contract
export -f print_state
export -f print_deploy_plan
