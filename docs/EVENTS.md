# Smart Contract Events

This document describes all Soroban events emitted by ZK-VOTE smart contracts. Events are published on-chain and can be indexed and consumed by off-chain consumers (relayers, indexers, frontends).

## Event Structure

Each event is defined with the `#[soroban_sdk::contractevent]` macro. Fields marked with `#[topic]` are indexed and can be efficiently queried. All types use Soroban's standard serialization.

## DAO Registry Contract Events

### `DaoCreateEvent`
Emitted when a new DAO is created.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | Unique identifier for the DAO |
| `admin` | Address | | Initial admin/creator address |
| `name` | String | | DAO name |

**Example Use Case**: Indexers track all DAOs created on the platform; frontends display creation events.

### `AdminXferEvent`
Emitted when DAO admin privileges are transferred.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `from` | Address | ✓ | Previous admin |
| `to` | Address | | New admin address |

---

### `CircuitUpgradeProposedEvent`
Emitted when a circuit upgrade is proposed for a DAO.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `from_circuit_id` | String | | Current circuit ID |
| `to_circuit_id` | String | | New circuit ID |
| `deadline` | u64 | | Upgrade deadline (ledger timestamp) |

### `CircuitUpgradeApprovedEvent`
Emitted when a circuit upgrade is approved by DAO vote.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `proposal_id` | u64 | ✓ | Upgrade proposal ID |

---

## Membership SBT Contract Events

### `SbtMintEvent`
Emitted when an SBT membership token is minted (user joins DAO).

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `to` | Address | | New member address |

### `SbtRevokeEvent`
Emitted when an SBT membership is revoked (user expelled by admin).

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `member` | Address | | Member address with revoked SBT |

### `SbtLeaveEvent`
Emitted when a user voluntarily leaves a DAO.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `member` | Address | | Member address leaving |

### `ContractUpgraded`
Emitted when the membership SBT contract code is upgraded.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `from` | u32 | | Previous contract version |
| `to` | u32 | | New contract version |

---

## Membership Tree Contract Events

### `TreeInitEvent`
Emitted when a Poseidon Merkle tree is initialized for a DAO.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `depth` | u32 | | Tree depth (max 32) |
| `empty_root` | U256 | | Empty root hash |
| `root_index` | u32 | | Current root index in history |

### `CommitEvent`
Emitted when a new leaf commitment is added to the tree.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `commitment` | U256 | | Leaf commitment hash |
| `index` | u32 | | Position in tree |
| `new_root` | U256 | | Updated tree root |
| `root_index` | u32 | | Root history index |

### `RemovalEvent`
Emitted when a leaf is removed (user evicted or left DAO).

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `member` | Address | ✓ | Member being removed |
| `index` | u32 | | Leaf index |
| `new_root` | U256 | | Updated tree root |
| `root_index` | u32 | | Root history index |

### `RootRolledOverEvent`
Emitted when tree root changes (periodic rollover).

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `new_root` | U256 | | New root hash |
| `root_index` | u32 | | Root history index |
| `height` | u32 | | Tree height after change |

---

## Voting Contract Events

### `ProposalEvent`
Emitted when a new proposal is created.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `proposal_id` | u64 | | Unique proposal ID |
| `creator` | Address | | Proposal creator |
| `start_time` | u64 | | Voting start (ledger timestamp) |
| `end_time` | u64 | | Voting end (ledger timestamp) |
| `vk_version` | u32 | | Verification key version used |

### `VoteEvent`
Emitted when a vote is cast.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `proposal_id` | u64 | ✓ | Proposal being voted on |
| `choice` | bool | | Vote choice (true/false) |
| `nullifier` | U256 | | Voter nullifier (prevents double voting) |

**Note**: Nullifier ensures anonymity while preventing duplicate votes. The voter's identity is not revealed on-chain.

### `ProposalClosedEvent`
Emitted when voting closes (end time reached or early close).

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `proposal_id` | u64 | | Proposal closed |
| `votes_for` | u64 | | Final "yes" vote count |
| `votes_against` | u64 | | Final "no" vote count |

### `ProposalArchivedEvent`
Emitted when a closed proposal is archived.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `proposal_id` | u64 | | Proposal archived |

### `VKSetEvent`
Emitted when a new verification key is registered.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `vk_version` | u32 | ✓ | VK version number |
| `circuit_type` | CircuitType | | Circuit type (e.g., Groth16) |

---

## Comments Contract Events

### `CommentCreatedEvent`
Emitted when a new comment is posted.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `proposal_id` | u64 | ✓ | Associated proposal |
| `comment_id` | u64 | | Unique comment ID |
| `is_anonymous` | bool | | Anonymous flag |

### `CommentEditedEvent`
Emitted when a comment is edited.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `proposal_id` | u64 | ✓ | Associated proposal |
| `comment_id` | u64 | | Comment edited |

### `CommentDeletedEvent`
Emitted when a comment is deleted.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO identifier |
| `proposal_id` | u64 | ✓ | Associated proposal |
| `comment_id` | u64 | | Comment deleted |
| `deleted_by` | u32 | | Reason (admin/author/auto) |

---

## Circuit Registry Contract Events

### `CircuitRegisteredEvent`
Emitted when a new ZK circuit is registered.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `circuit_id` | String | ✓ | Unique circuit identifier |
| `circuit_type` | CircuitType | | Circuit type (Groth16/etc) |
| `registered_at` | u64 | | Registration timestamp |

### `DaoMigrationEvent`
Emitted when a DAO migrates to a new circuit.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO migrating |
| `from_circuit_id` | String | | Old circuit |
| `to_circuit_id` | String | | New circuit |
| `deadline` | u64 | | Migration deadline |

### `CircuitUpgradedEvent`
Emitted when a DAO successfully upgrades its circuit.

| Field | Type | Topic | Description |
|-------|------|-------|-------------|
| `dao_id` | u64 | ✓ | DAO upgraded |
| `circuit_type` | CircuitType | | Circuit type after upgrade |
| `to_circuit_id` | String | | New circuit ID |

---

## Indexing Guide

To efficiently consume these events:

1. **Use topic indices**: Filter by `dao_id` and other `#[topic]` fields for efficient queries
2. **Monitor proposal lifecycle**: Track `ProposalEvent` → votes → `ProposalClosedEvent` → `ProposalArchivedEvent`
3. **Verify membership**: Cross-reference `CommitEvent` (tree updates) with `SbtMintEvent` (membership)
4. **Nullifier validation**: Ensure votes have unique nullifiers (stored in events)

## TypeScript Consumer Types

Auto-generated TypeScript types for these events are available in `backend/src/generated/contract-events.ts`.
